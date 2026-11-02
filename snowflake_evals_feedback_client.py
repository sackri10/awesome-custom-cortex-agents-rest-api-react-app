"""
Pull Cortex eval results and agent feedback from Snowflake over REST.

There's no dedicated REST endpoint for eval results or for reading
feedback, so this goes through the Snowflake SQL API
(POST /api/v2/statements) and calls the SNOWFLAKE.LOCAL table functions.

Handles: async statements (HTTP 202 + polling), multi-partition results,
VARIANT/OBJECT/ARRAY parsing, timestamps, retries on 429/5xx.

Usage:
  pip install requests
  export SNOWFLAKE_ACCOUNT_URL="https://<account_identifier>.snowflakecomputing.com"
  export SNOWFLAKE_PAT="<programmatic access token>"

  python snowflake_evals_feedback_client.py feedback --since "2026-11-01 00:00:00"
  python snowflake_evals_feedback_client.py agent-eval agent_run_a
  python snowflake_evals_feedback_client.py agent-eval-summary agent_run_a
  python snowflake_evals_feedback_client.py analyst-eval sv_run_a
  python snowflake_evals_feedback_client.py trace <record_id>
  python snowflake_evals_feedback_client.py start-eval agent_run_d @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml
  python snowflake_evals_feedback_client.py eval-status agent_run_d @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml

Output is JSON on stdout. Add --out file.json to write it to a file.
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
import uuid

import requests

# ----------------------------------------------------------------------
# Settings (override with env vars)
# ----------------------------------------------------------------------
DATABASE = os.environ.get("SF_DATABASE", "SALES_EVAL_DB")
SCHEMA = os.environ.get("SF_SCHEMA", "DATA")
WAREHOUSE = os.environ.get("SF_WAREHOUSE", "SALES_EVAL_WH")
ROLE = os.environ.get("SF_ROLE", "SALES_EVAL_ROLE")
AGENT = os.environ.get("SF_AGENT", "SALES_AGENT")
SEMANTIC_VIEW = os.environ.get("SF_SEMANTIC_VIEW", "SALES_SV")

JSON_TYPES = {"variant", "object", "array"}
TIMESTAMP_TYPES = {"timestamp_ntz", "timestamp_ltz", "timestamp_tz", "date", "time"}


class SnowflakeAPIError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {str(body)[:500]}")


# ----------------------------------------------------------------------
# SQL API client
# ----------------------------------------------------------------------
class SnowflakeSQLClient:
    def __init__(self, account_url, token, token_type="PROGRAMMATIC_ACCESS_TOKEN",
                 role=ROLE, warehouse=WAREHOUSE, database=DATABASE, schema=SCHEMA,
                 session=None):
        self.base = account_url.rstrip("/") + "/api/v2/statements"
        self.ctx = {"role": role, "warehouse": warehouse, "database": database, "schema": schema}
        self.http = session or requests.Session()
        self.http.headers.update({
            "Authorization": f"Bearer {token}",
            "X-Snowflake-Authorization-Token-Type": token_type,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "cortex-evals-feedback-client/1.0",
        })

    # -- low level ------------------------------------------------------
    def _request(self, method, url, retries=5, **kwargs):
        delay = 1.0
        for attempt in range(retries):
            r = self.http.request(method, url, timeout=120, **kwargs)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            return r
        return r

    @staticmethod
    def _body(r):
        try:
            return r.json()
        except ValueError:
            return r.text

    def _wait(self, handle, poll_seconds, max_wait):
        """Poll GET /statements/{handle} until it stops returning 202."""
        start = time.time()
        while True:
            r = self._request("GET", f"{self.base}/{handle}")
            if r.status_code != 202:
                return r
            if time.time() - start > max_wait:
                self._request("POST", f"{self.base}/{handle}/cancel")
                raise TimeoutError(f"Statement {handle} still running after {max_wait}s, cancelled")
            time.sleep(poll_seconds)

    # -- public ---------------------------------------------------------
    def execute(self, sql, binds=None, timeout=600, poll_seconds=2, max_wait=900):
        """Run one statement, return rows as a list of dicts."""
        body = {"statement": sql, "timeout": timeout, **self.ctx}
        if binds:
            body["bindings"] = {
                str(i + 1): {"type": "TEXT", "value": None if v is None else str(v)}
                for i, v in enumerate(binds)
            }
        r = self._request("POST", self.base, params={"requestId": str(uuid.uuid4())}, json=body)
        if r.status_code == 202:
            r = self._wait(self._body(r)["statementHandle"], poll_seconds, max_wait)
        if r.status_code != 200:
            raise SnowflakeAPIError(r.status_code, self._body(r))
        return self._collect(self._body(r))

    def _collect(self, first):
        meta = first.get("resultSetMetaData", {}) or {}
        columns = meta.get("rowType", []) or []
        partitions = meta.get("partitionInfo", []) or [{}]
        handle = first.get("statementHandle")

        rows = list(first.get("data") or [])
        for p in range(1, len(partitions)):
            r = self._request("GET", f"{self.base}/{handle}", params={"partition": p})
            if r.status_code != 200:
                raise SnowflakeAPIError(r.status_code, self._body(r))
            rows.extend(self._body(r).get("data") or [])
        return [self._row_to_dict(columns, row) for row in rows]

    @staticmethod
    def _convert(value, col_type):
        if value is None:
            return None
        t = (col_type or "").lower()
        if t in JSON_TYPES:
            try:
                return json.loads(value)
            except (TypeError, ValueError):
                return value
        if t in ("timestamp_ntz", "timestamp_ltz"):
            # SQL API returns epoch seconds as a string, e.g. "1762063200.123000000"
            try:
                return dt.datetime.fromtimestamp(float(value), tz=dt.timezone.utc).isoformat()
            except ValueError:
                return value
        if t == "timestamp_tz":
            # "<epoch> <offset minutes + 1440>"
            try:
                epoch = float(value.split()[0])
                return dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc).isoformat()
            except (ValueError, IndexError):
                return value
        if t == "date":
            try:
                return (dt.date(1970, 1, 1) + dt.timedelta(days=int(value))).isoformat()
            except ValueError:
                return value
        if t == "fixed":
            try:
                f = float(value)
                return int(f) if f.is_integer() and "." not in value else f
            except ValueError:
                return value
        if t == "real":
            try:
                return float(value)
            except ValueError:
                return value
        if t == "boolean":
            return value.lower() == "true"
        return value

    def _row_to_dict(self, columns, row):
        return {
            col.get("name"): self._convert(val, col.get("type"))
            for col, val in zip(columns, row)
        }


# ----------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------
class CortexObservability:
    def __init__(self, client, database=DATABASE, schema=SCHEMA,
                 agent=AGENT, semantic_view=SEMANTIC_VIEW):
        self.c = client
        self.db, self.schema = database, schema
        self.agent, self.sv = agent, semantic_view

    # ---- eval runs ----------------------------------------------------
    def start_eval(self, run_name, config_path):
        return self.c.execute(
            "CALL EXECUTE_AI_EVALUATION('START', OBJECT_CONSTRUCT('run_name', ?), ?)",
            [run_name, config_path])

    def eval_status(self, run_name, config_path):
        return self.c.execute(
            "CALL EXECUTE_AI_EVALUATION('STATUS', OBJECT_CONSTRUCT('run_name', ?), ?)",
            [run_name, config_path])

    def wait_for_eval(self, run_name, config_path, poll_seconds=30, max_wait=3600):
        """Poll STATUS until the run looks finished. Returns the last status rows.
        The status table format can change, so this checks every value in the
        rows for a terminal word rather than one specific column."""
        terminal = ("COMPLETED", "SUCCESS", "FAILED", "CANCELLED", "PARTIALLY_COMPLETED")
        start = time.time()
        while True:
            rows = self.eval_status(run_name, config_path)
            text = json.dumps(rows).upper()
            if any(t in text for t in terminal) and "IN_PROGRESS" not in text and "RUNNING" not in text:
                return rows
            if time.time() - start > max_wait:
                raise TimeoutError(f"Eval {run_name} not finished after {max_wait}s")
            time.sleep(poll_seconds)

    # ---- eval results -------------------------------------------------
    def agent_eval_results(self, run_name):
        return self.c.execute(
            "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))",
            [self.db, self.schema, self.agent, run_name])

    def agent_eval_summary(self, run_name):
        return self.c.execute(
            """SELECT METRIC_NAME,
                      COUNT(*)                      AS RECORDS,
                      ROUND(AVG(EVAL_AGG_SCORE), 3) AS AVG_SCORE,
                      MIN(EVAL_AGG_SCORE)           AS MIN_SCORE
               FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))
               GROUP BY METRIC_NAME
               ORDER BY METRIC_NAME""",
            [self.db, self.schema, self.agent, run_name])

    def analyst_eval_results(self, run_name):
        return self.c.execute(
            "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_ANALYST_AI_EVALUATION_DATA(?, ?, ?, 'SEMANTIC VIEW', ?))",
            [self.db, self.schema, self.sv, run_name])

    def record_trace(self, record_id):
        return self.c.execute(
            "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_RECORD_TRACE(?, ?, ?, 'CORTEX AGENT', ?))",
            [self.db, self.schema, self.agent, record_id])

    def eval_logs(self, run_name):
        return self.c.execute(
            """SELECT TIMESTAMP, RECORD, RECORD_ATTRIBUTES, VALUE
               FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_LOGS(?, ?, ?, 'CORTEX AGENT'))
               WHERE RECORD:"severity_text" IN ('ERROR', 'WARN')
                 AND RECORD_ATTRIBUTES:"snow.ai.observability.run.name" = ?""",
            [self.db, self.schema, self.agent, run_name])

    # ---- feedback -----------------------------------------------------
    def feedback(self, since=None, until=None):
        """Agent feedback events, oldest first. since/until: 'YYYY-MM-DD HH:MM:SS' (UTC)."""
        sql = """SELECT TIMESTAMP, TRACE, RECORD, RECORD_ATTRIBUTES, VALUE
                 FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(?, ?, ?, 'CORTEX AGENT'))
                 WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK'"""
        binds = [self.db, self.schema, self.agent]
        if since:
            sql += " AND TIMESTAMP > TO_TIMESTAMP_NTZ(?)"
            binds.append(since)
        if until:
            sql += " AND TIMESTAMP <= TO_TIMESTAMP_NTZ(?)"
            binds.append(until)
        sql += " ORDER BY TIMESTAMP"
        return [normalize_feedback(r) for r in self.c.execute(sql, binds)]


def normalize_feedback(row):
    """Flatten a feedback event into a stable shape. Field names inside the
    event aren't fully documented, so this searches the attributes for the
    likely keys and keeps the raw event alongside."""
    attrs = row.get("RECORD_ATTRIBUTES") or {}
    value = row.get("VALUE") or {}

    def pick(*keys):
        for src in (attrs, value):
            if isinstance(src, dict):
                for k in src:
                    if any(k.lower().endswith(key) for key in keys):
                        return src[k]
        return None

    positive = pick("positive")
    if isinstance(positive, str):
        positive = positive.lower() == "true"
    return {
        "timestamp": row.get("TIMESTAMP"),
        "positive": positive,
        "feedback_message": pick("feedback_message", "message"),
        "categories": pick("categories"),
        "user": pick("user.name", "user_name", "user"),
        "request_id": pick("orig_request_id", "request_id", "record_id"),
        "thread_id": pick("thread_id"),
        "raw": {"record": row.get("RECORD"), "attributes": attrs, "value": value, "trace": row.get("TRACE")},
    }


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------
def build():
    url = os.environ.get("SNOWFLAKE_ACCOUNT_URL", "")
    token = os.environ.get("SNOWFLAKE_PAT", "")
    if not url or not token:
        sys.exit("Set SNOWFLAKE_ACCOUNT_URL and SNOWFLAKE_PAT first.")
    token_type = os.environ.get("SNOWFLAKE_TOKEN_TYPE", "PROGRAMMATIC_ACCESS_TOKEN")
    return CortexObservability(SnowflakeSQLClient(url, token, token_type))


def main():
    p = argparse.ArgumentParser(description="Cortex eval results and feedback over the Snowflake SQL API")
    p.add_argument("--out", help="write JSON to this file instead of stdout")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("feedback"); f.add_argument("--since"); f.add_argument("--until")
    sub.add_parser("agent-eval").add_argument("run_name")
    sub.add_parser("agent-eval-summary").add_argument("run_name")
    sub.add_parser("analyst-eval").add_argument("run_name")
    sub.add_parser("eval-logs").add_argument("run_name")
    sub.add_parser("trace").add_argument("record_id")
    for name in ("start-eval", "eval-status", "wait-eval"):
        s = sub.add_parser(name); s.add_argument("run_name"); s.add_argument("config_path")

    a = p.parse_args()
    obs = build()
    dispatch = {
        "feedback": lambda: obs.feedback(a.since, a.until),
        "agent-eval": lambda: obs.agent_eval_results(a.run_name),
        "agent-eval-summary": lambda: obs.agent_eval_summary(a.run_name),
        "analyst-eval": lambda: obs.analyst_eval_results(a.run_name),
        "eval-logs": lambda: obs.eval_logs(a.run_name),
        "trace": lambda: obs.record_trace(a.record_id),
        "start-eval": lambda: obs.start_eval(a.run_name, a.config_path),
        "eval-status": lambda: obs.eval_status(a.run_name, a.config_path),
        "wait-eval": lambda: obs.wait_for_eval(a.run_name, a.config_path),
    }
    try:
        result = dispatch[a.cmd]()
    except SnowflakeAPIError as e:
        sys.exit(f"Snowflake error: {e}")

    text = json.dumps(result, indent=2, default=str)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {len(result)} rows to {a.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
