/**
 * Cortex Agent evaluations + feedback over the Snowflake SQL API.
 *
 * There is no dedicated REST endpoint for eval results or for reading feedback,
 * so these go through POST /api/v2/statements and call the SNOWFLAKE.LOCAL table
 * functions (GET_AI_EVALUATION_DATA, GET_AI_OBSERVABILITY_EVENTS, ...).
 *
 * Port of snowflake_evals_feedback_client.py. Handles: bind variables, async
 * statements (HTTP 202 + polling), multi-partition results, VARIANT/timestamp
 * conversion, and retries on 429/5xx.
 *
 * See cortex_agent_evals_and_feedback.md for the privileges each query needs.
 */

const crypto = require('crypto');

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const JSON_TYPES = new Set(['variant', 'object', 'array']);

class SnowflakeSqlError extends Error {
  constructor(status, body) {
    const message = (body && (body.message || body.error)) || `Snowflake SQL API returned HTTP ${status}`;
    super(message);
    this.name = 'SnowflakeSqlError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (response) => {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/**
 * Convert one SQL API cell (always a string) into a JS value based on its column type.
 */
const convertValue = (value, colType) => {
  if (value === null || value === undefined) return null;
  const t = String(colType || '').toLowerCase();
  if (JSON_TYPES.has(t)) {
    try { return JSON.parse(value); } catch { return value; }
  }
  if (t === 'timestamp_ntz' || t === 'timestamp_ltz' || t === 'timestamp_tz') {
    // Epoch seconds as a string; TIMESTAMP_TZ appends " <offset>"
    const epoch = parseFloat(String(value).split(' ')[0]);
    return Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString() : value;
  }
  if (t === 'date') {
    const days = parseInt(value, 10);
    return Number.isFinite(days) ? new Date(days * 86400000).toISOString().slice(0, 10) : value;
  }
  if (t === 'fixed' || t === 'real') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (t === 'boolean') return String(value).toLowerCase() === 'true';
  return value;
};

/**
 * Create a SQL API client bound to one Snowflake account + context.
 * config: { host, pat, database, schema, warehouse, role }
 */
const createSqlClient = (config) => {
  const base = `https://${config.host}/api/v2/statements`;
  const headers = {
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    'Authorization': `Bearer ${config.pat}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'cortex-agents-react-app-evals/1.0',
  };

  const request = async (method, url, body, retries = 4) => {
    let delay = 1000;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (RETRYABLE.has(response.status) && attempt < retries) {
        await sleep(delay);
        delay = Math.min(delay * 2, 15000);
        continue;
      }
      return { status: response.status, json: await readJson(response) };
    }
  };

  const waitFor = async (handle, { pollMs, maxWaitMs }) => {
    const start = Date.now();
    for (;;) {
      const result = await request('GET', `${base}/${handle}`);
      if (result.status !== 202) return result;
      if (Date.now() - start > maxWaitMs) {
        await request('POST', `${base}/${handle}/cancel`);
        throw new SnowflakeSqlError(408, { message: `Statement ${handle} still running after ${maxWaitMs / 1000}s, cancelled.` });
      }
      await sleep(pollMs);
    }
  };

  const collect = async (first) => {
    const meta = first.resultSetMetaData || {};
    const columns = meta.rowType || [];
    const partitions = meta.partitionInfo || [{}];
    const rows = [...(first.data || [])];
    for (let p = 1; p < partitions.length; p++) {
      const result = await request('GET', `${base}/${first.statementHandle}?partition=${p}`);
      if (result.status !== 200) throw new SnowflakeSqlError(result.status, result.json);
      rows.push(...((result.json && result.json.data) || []));
    }
    return rows.map((row) => {
      const obj = {};
      columns.forEach((col, i) => { obj[col.name] = convertValue(row[i], col.type); });
      return obj;
    });
  };

  /**
   * Run one statement with positional `?` binds. Returns rows as objects.
   */
  const execute = async (statement, binds = [], { timeout = 600, pollMs = 2000, maxWaitMs = 120000 } = {}) => {
    const body = {
      statement,
      timeout,
      database: config.database,
      schema: config.schema,
      parameters: { query_tag: 'cortex_agents_react_app_evals' },
    };
    if (config.warehouse) body.warehouse = config.warehouse;
    if (config.role) body.role = config.role;
    if (binds.length) {
      body.bindings = {};
      binds.forEach((v, i) => {
        body.bindings[String(i + 1)] = { type: 'TEXT', value: v === null || v === undefined ? null : String(v) };
      });
    }

    let result = await request('POST', `${base}?requestId=${crypto.randomUUID()}`, body);
    if (result.status === 202 && result.json && result.json.statementHandle) {
      result = await waitFor(result.json.statementHandle, { pollMs, maxWaitMs });
    }
    if (result.status !== 200) throw new SnowflakeSqlError(result.status, result.json);
    return collect(result.json || {});
  };

  return { execute };
};

/**
 * Flatten a CORTEX_AGENT_FEEDBACK event into a stable shape. The attribute names
 * inside the event aren't fully documented, so this matches on key-name endings
 * and keeps the raw event alongside. Tighten to exact keys once you've seen real rows.
 */
const normalizeFeedback = (row) => {
  const attrs = (row.RECORD_ATTRIBUTES && typeof row.RECORD_ATTRIBUTES === 'object') ? row.RECORD_ATTRIBUTES : {};
  const value = (row.VALUE && typeof row.VALUE === 'object') ? row.VALUE : {};

  const pick = (...keys) => {
    for (const src of [attrs, value]) {
      for (const k of Object.keys(src)) {
        const lower = k.toLowerCase();
        if (keys.some((key) => lower.endsWith(key))) return src[k];
      }
    }
    return null;
  };

  let positive = pick('positive');
  if (typeof positive === 'string') positive = positive.toLowerCase() === 'true';

  let categories = pick('categories');
  if (typeof categories === 'string') {
    try { categories = JSON.parse(categories); } catch { categories = [categories]; }
  }

  return {
    timestamp: row.TIMESTAMP,
    positive: typeof positive === 'boolean' ? positive : null,
    feedback_message: pick('feedback_message', 'message'),
    categories: Array.isArray(categories) ? categories : [],
    user: pick('user.name', 'user_name', 'user'),
    request_id: pick('orig_request_id', 'request_id', 'record_id'),
    thread_id: pick('thread_id'),
    raw: { record: row.RECORD, attributes: attrs, value, trace: row.TRACE },
  };
};

/**
 * Query catalogue (section 8.3, Phase 3 of the doc). All inputs are bound.
 */
const createObservability = (client, { database, schema }) => ({
  startEval: (runName, configPath) =>
    client.execute("CALL EXECUTE_AI_EVALUATION('START', OBJECT_CONSTRUCT('run_name', ?), ?)", [runName, configPath]),

  evalStatus: (runName, configPath) =>
    client.execute("CALL EXECUTE_AI_EVALUATION('STATUS', OBJECT_CONSTRUCT('run_name', ?), ?)", [runName, configPath]),

  agentEvalResults: (agent, runName) =>
    client.execute(
      "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))",
      [database, schema, agent, runName]
    ),

  agentEvalSummary: (agent, runName) =>
    client.execute(
      `SELECT METRIC_NAME,
              COUNT(*)                      AS RECORDS,
              ROUND(AVG(EVAL_AGG_SCORE), 3) AS AVG_SCORE,
              MIN(EVAL_AGG_SCORE)           AS MIN_SCORE
       FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))
       GROUP BY METRIC_NAME
       ORDER BY METRIC_NAME`,
      [database, schema, agent, runName]
    ),

  recordTrace: (agent, recordId) =>
    client.execute(
      "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_RECORD_TRACE(?, ?, ?, 'CORTEX AGENT', ?))",
      [database, schema, agent, recordId]
    ),

  evalLogs: (agent, runName) =>
    client.execute(
      `SELECT TIMESTAMP, RECORD, RECORD_ATTRIBUTES, VALUE
       FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_LOGS(?, ?, ?, 'CORTEX AGENT'))
       WHERE RECORD:"severity_text" IN ('ERROR', 'WARN')
         AND RECORD_ATTRIBUTES:"snow.ai.observability.run.name" = ?
       ORDER BY TIMESTAMP DESC`,
      [database, schema, agent, runName]
    ),

  feedback: async (agent, { since, until } = {}) => {
    let sql = `SELECT TIMESTAMP, TRACE, RECORD, RECORD_ATTRIBUTES, VALUE
               FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(?, ?, ?, 'CORTEX AGENT'))
               WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK'`;
    const binds = [database, schema, agent];
    if (since) { sql += ' AND TIMESTAMP > TO_TIMESTAMP_NTZ(?)'; binds.push(since); }
    if (until) { sql += ' AND TIMESTAMP <= TO_TIMESTAMP_NTZ(?)'; binds.push(until); }
    sql += ' ORDER BY TIMESTAMP DESC';
    const rows = await client.execute(sql, binds);
    return rows.map(normalizeFeedback);
  },
});

/**
 * Best-effort read of a STATUS result. The STATUS table format isn't a stable
 * contract, so look for terminal words anywhere in the rows.
 */
const summarizeStatus = (rows) => {
  const text = JSON.stringify(rows || []).toUpperCase();
  if (/IN_PROGRESS|RUNNING|PENDING|QUEUED|STARTED/.test(text) && !/COMPLETED|SUCCESS/.test(text)) return 'RUNNING';
  if (/PARTIALLY_COMPLETED/.test(text)) return 'PARTIALLY_COMPLETED';
  if (/FAILED/.test(text)) return 'FAILED';
  if (/CANCELLED|CANCELED/.test(text)) return 'CANCELLED';
  if (/COMPLETED|SUCCESS/.test(text)) return 'COMPLETED';
  return 'UNKNOWN';
};

module.exports = {
  createSqlClient,
  createObservability,
  normalizeFeedback,
  summarizeStatus,
  SnowflakeSqlError,
};
