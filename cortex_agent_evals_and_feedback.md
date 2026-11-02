# Cortex Agent: Evaluations and Feedback API

How to evaluate `SALES_AGENT` against a ground-truth dataset, how to record user feedback through the REST API when the Snowsight agent preview won't save it, and how to pull eval results and feedback out over REST (section 8).

Everything below uses the objects from `sales_semantic_view_evals.sql`:

| Object | Name |
|---|---|
| Database / schema | `SALES_EVAL_DB.DATA` |
| Role | `SALES_EVAL_ROLE` |
| Warehouse | `SALES_EVAL_WH` |
| Semantic view | `SALES_EVAL_DB.DATA.SALES_SV` |
| Agent | `SALES_EVAL_DB.DATA.SALES_AGENT` (tool: `SalesAnalyst`) |
| Config stage | `@SALES_EVAL_DB.DATA.EVAL_CONFIGS` |

---

## 1. Evals and feedback

They answer different questions, so you want both.

| | Agent evaluation | User feedback |
|---|---|---|
| Who judges | LLM judge, against your ground truth | Real users |
| When | Batch runs you start (manually, task, CI) | Whenever someone uses the agent |
| Input | Dataset table of questions + expected answers | Thumbs up/down, categories, comment on a live answer |
| How you trigger it | SQL: `EXECUTE_AI_EVALUATION` | REST: `POST .../agents/{name}:feedback` |
| How you read it | SQL: `GET_AI_EVALUATION_DATA` | SQL: `GET_AI_OBSERVABILITY_EVENTS`, filtered to `CORTEX_AGENT_FEEDBACK` |
| Dedicated REST endpoint | No (use the SQL API to call it over HTTP) | Yes, for submitting |

Feedback doesn't show up inside eval scores. The link between them is manual: bad feedback becomes new rows in the eval dataset (section 6).

---

## 2. Privileges

Eval tasks ignore secondary roles, so put everything on one primary role.

**To run agent evals**
- `SNOWFLAKE.CORTEX_USER` database role
- `EXECUTE TASK ON ACCOUNT`
- `USAGE` on the agent's database and schema, plus `USAGE` or `OWNERSHIP` and `MONITOR` or `OWNERSHIP` on the agent
- `CREATE TABLE` and `CREATE DATASET` on the schema holding the dataset
- `CREATE FILE FORMAT` and `CREATE TASK` on the schema you run from (plus `CREATE STAGE` if you make the config stage)
- `READ` on the config stage
- Access to every tool the agent uses (the semantic view and its tables)

`SALES_EVAL_ROLE` owns the database, so it already has all of this from the setup script.

**To read feedback and traces**
- `OWNERSHIP` or `MONITOR` on the agent
- `SNOWFLAKE.CORTEX_USER`
- `SNOWFLAKE.AI_OBSERVABILITY_READER` application role (read-only on the events table)
- `READ UNREDACTED AI OBSERVABILITY EVENTS TABLE` (account privilege) to see the actual feedback text instead of a redacted version

```sql
USE ROLE ACCOUNTADMIN;
GRANT APPLICATION ROLE SNOWFLAKE.AI_OBSERVABILITY_READER TO ROLE SALES_EVAL_ROLE;
GRANT READ UNREDACTED AI OBSERVABILITY EVENTS TABLE ON ACCOUNT TO ROLE SALES_EVAL_ROLE;
```

Verified on this account (2026-11-02): with the second GRANT in place, the feedback text and rating come back through the SQL API for `SALES_EVAL_ROLE`. Without it, the same query returns only the categories, and the rating and comment are missing.

If you're using a PAT, the role has to be one the PAT is allowed to use. `ACCOUNTADMIN` was rejected for this PAT (error 390186), so the grant has to go to the PAT's role, here `SALES_EVAL_ROLE`.

---

## 3. Agent evaluations

### 3.1 Dataset

Two columns: the question, and a VARIANT holding ground truth.

- `ground_truth_output`: the expected answer in plain language, with the literal numbers. Used by `answer_correctness`.
- `ground_truth_invocations`: expected tool calls. Each entry has `tool_name` (required), plus optional `tool_input` and `tool_output`. Use `[]` when the agent should call no tool. Used by `tool_selection_accuracy` and `tool_execution_accuracy`.

```sql
USE ROLE SALES_EVAL_ROLE;
USE WAREHOUSE SALES_EVAL_WH;
USE SCHEMA SALES_EVAL_DB.DATA;

CREATE OR REPLACE TABLE AGENT_EVAL_DATA (
  INPUT_QUERY  VARCHAR,
  GROUND_TRUTH VARIANT
);

INSERT INTO AGENT_EVAL_DATA
SELECT column1, PARSE_JSON(column2) FROM VALUES
  ('What was total revenue in Q1 2026?',
   '{"ground_truth_output": "Total revenue for Q1 2026 (January to March 2026) was 53,250.00 USD, excluding cancelled orders.",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "total revenue in Q1 2026"}]}'),
  ('Which region had the highest revenue in Q1 2026?',
   '{"ground_truth_output": "East had the highest revenue in Q1 2026 with 21,600.00 USD.",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "revenue by region for Q1 2026"}]}'),
  ('What is the average order value for Enterprise customers?',
   '{"ground_truth_output": "Average order value for Enterprise customers is about 11,826.92 USD (153,750 revenue over 13 non-cancelled orders).",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "average order value for Enterprise segment"}]}'),
  ('Which product category sold the most units in Q1 2026?',
   '{"ground_truth_output": "Services sold the most units in Q1 2026 with 37 units, ahead of Hardware with 35.",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "units sold by product category Q1 2026"}]}'),
  ('Did revenue go up or down from Q4 2025 to Q1 2026?',
   '{"ground_truth_output": "Revenue went up, from 35,550.00 USD in Q4 2025 to 53,250.00 USD in Q1 2026, an increase of 17,700.00 USD (about 49.8 percent).",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "revenue Q4 2025 vs Q1 2026"}]}'),
  ('How many orders were cancelled in 2025?',
   '{"ground_truth_output": "3 orders were cancelled in 2025.",
     "ground_truth_invocations": [{"tool_name": "SalesAnalyst", "tool_input": "count of cancelled orders in 2025"}]}'),
  ('What is the weather in Hyderabad today?',
   '{"ground_truth_output": "The agent says it can only answer questions about sales data and does not provide weather.",
     "ground_truth_invocations": []}'),
  ('What did the customer say on the last sales call with Apex Logistics?',
   '{"ground_truth_output": "The agent says it has no access to sales call notes or conversation transcripts, only order and customer data. It does not invent call content.",
     "ground_truth_invocations": []}');
```

Write the ground truth as something a judge can check: actual numbers, actual names. "Should give the right revenue" is useless to a judge.

### 3.2 Config files

Two files: one for the first run, which also registers the dataset, and one for every run after that. Registering the same dataset name twice fails.

Names must be **fully qualified**. A bare `SALES_AGENT` or `SALES_SV` gives `must be a fully qualified name in function EXECUTE_AI_EVALUATION`.

The helper proc `WRITE_TO_STAGE` from the setup script writes YAML to the stage, so you don't need `PUT` (which doesn't run in a Snowsight worksheet).

```sql
-- First run: registers AGENT_EVAL_DATA as dataset sales_agent_eval_v1
CALL SALES_EVAL_DB.DATA.WRITE_TO_STAGE(
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_first.yaml',
$$dataset:
  dataset_type: "CORTEX AGENT"
  table_name: "SALES_EVAL_DB.DATA.AGENT_EVAL_DATA"
  dataset_name: "sales_agent_eval_v1"
  column_mapping:
    query_text: "INPUT_QUERY"
    ground_truth: "GROUND_TRUTH"

evaluation:
  agent_params:
    agent_name: "SALES_EVAL_DB.DATA.SALES_AGENT"
    agent_type: "CORTEX AGENT"
  run_params:
    label: "Sales agent baseline"
  source_metadata:
    type: "dataset"
    dataset_name: "sales_agent_eval_v1"

metrics:
  - name: "answer_correctness"
    version: "v3"
  - "logical_consistency"
  - "tool_selection_accuracy"
  - "tool_execution_accuracy"
  - name: "no_fabrication"
    score_ranges:
      min_score: [0, 0.33]
      median_score: [0.34, 0.66]
      max_score: [0.67, 1]
    prompt: |
      You are checking a sales analytics agent's answer for fabricated facts.
      Question and answer: {{output}}
      Expected behavior: {{ground_truth}}
      Score 1 if every number, customer name and claim is supported by the expected
      behavior or plainly comes from the sales data. Score 0 if the answer invents
      data, call notes, or anything not in the sales data.
$$);

-- Every later run: no dataset block
CALL SALES_EVAL_DB.DATA.WRITE_TO_STAGE(
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml',
$$evaluation:
  agent_params:
    agent_name: "SALES_EVAL_DB.DATA.SALES_AGENT"
    agent_type: "CORTEX AGENT"
  run_params:
    label: "Sales agent rerun"
  source_metadata:
    type: "dataset"
    dataset_name: "sales_agent_eval_v1"

metrics:
  - name: "answer_correctness"
    version: "v3"
  - "logical_consistency"
  - "tool_selection_accuracy"
  - "tool_execution_accuracy"
$$);

-- Confirm what's on the stage
SELECT METADATA$FILE_ROW_NUMBER AS line, $1
FROM @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_first.yaml
ORDER BY 1;
```

**The metrics**

| Metric | Needs ground truth? | What it tells you |
|---|---|---|
| `answer_correctness` | Yes, `ground_truth_output` | Final answer matches the expected one |
| `logical_consistency` | No | Instructions, plan and tool calls hang together |
| `tool_selection_accuracy` | Yes, `ground_truth_invocations` | Called the right tool, or correctly called none |
| `tool_execution_accuracy` | Yes, `ground_truth_invocations` | Gave the tool sensible input and got usable output |
| Custom (`no_fabrication`) | Your call | Whatever your prompt checks |

Tool selection and execution accuracy were in preview as of June 2026. If a run complains about them, drop those two lines and retry.

### 3.3 Run it

Runs execute against the session's database and schema, so set them first. Every run needs a unique name.

```sql
USE SCHEMA SALES_EVAL_DB.DATA;

CALL EXECUTE_AI_EVALUATION(
  'START',
  OBJECT_CONSTRUCT('run_name', 'agent_run_a'),
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_first.yaml'
);

-- Re-run until it reports complete
CALL EXECUTE_AI_EVALUATION(
  'STATUS',
  OBJECT_CONSTRUCT('run_name', 'agent_run_a'),
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_first.yaml'
);

-- Later runs use the rerun config
CALL EXECUTE_AI_EVALUATION(
  'START',
  OBJECT_CONSTRUCT('run_name', 'agent_run_b'),
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml'
);
```

`CANCEL` and `DELETE` take the same arguments. `DELETE` on a name that was never created returns `Run with name ... does not exist`, which is harmless.

### 3.4 Read the results

```sql
-- Everything: one row per question per metric
SELECT *
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT', 'agent_run_a'
));

-- Average per metric
SELECT METRIC_NAME,
       COUNT(*)                      AS records,
       ROUND(AVG(EVAL_AGG_SCORE), 3) AS avg_score
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT', 'agent_run_a'
))
GROUP BY METRIC_NAME
ORDER BY METRIC_NAME;

-- Weak answers, worst first
SELECT RECORD_ID, INPUT, OUTPUT, METRIC_NAME, EVAL_AGG_SCORE
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT', 'agent_run_a'
))
WHERE EVAL_AGG_SCORE < 0.7
ORDER BY EVAL_AGG_SCORE;

-- Step-by-step trace for one record
SELECT *
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_RECORD_TRACE(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT', '<record_id>'
));

-- Errors and warnings from the run
SELECT *
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_LOGS(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT'
))
WHERE RECORD:"severity_text" IN ('ERROR', 'WARN')
  AND RECORD_ATTRIBUTES:"snow.ai.observability.run.name" = 'agent_run_a';
```

Snowsight shows the same results under **AI & ML → Agents → SALES_AGENT → Evaluations**.

### 3.5 Reading the scores

| What you see | Where the problem is | Fix |
|---|---|---|
| Analyst eval fails the same question | SQL generation | Semantic view: comments, synonyms, `AI_SQL_GENERATION`, guidance verified queries |
| Low `tool_selection_accuracy` | Routing | Agent `orchestration` instruction and tool `description` |
| Tool selection fine, low `answer_correctness` | Final answer wording or interpretation | Agent `response` instruction |
| No-tool questions show a SalesAnalyst call | Over-eager routing | Tighten "do not call any tool for questions unrelated to sales data" |
| Low `no_fabrication` | Agent fills gaps instead of admitting them | Add "if the data cannot answer, say so" to the response instruction |

Run the same config three times before you trust a number. Scores move between runs even when nothing changed.

### 3.6 Calling evals over HTTP

There's no dedicated eval endpoint. Wrap the SQL in the Snowflake SQL API:

```bash
curl -X POST "https://<account>.snowflakecomputing.com/api/v2/statements" \
  -H "Authorization: Bearer $SNOWFLAKE_PAT" \
  -H "X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "statement": "CALL EXECUTE_AI_EVALUATION(''START'', OBJECT_CONSTRUCT(''run_name'', ''agent_run_c''), ''@SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml'')",
    "database": "SALES_EVAL_DB",
    "schema": "DATA",
    "warehouse": "SALES_EVAL_WH",
    "role": "SALES_EVAL_ROLE"
  }'
```

Status checks and result queries work the same way. Long statements return a handle you poll with `GET /api/v2/statements/{handle}`.

---

## 4. Recording feedback

### 4.1 Why it didn't save in the preview

Feedback shows up in agent monitoring for agents used through **Snowflake Intelligence** or the **Agent API**. The preview chat on the agent's page in Snowsight is a testing view, and in your case it isn't recording feedback. That matches the docs, which only describe feedback coming from those two routes. You have two options:

1. **Use the agent from Snowflake Intelligence**, which has thumbs up/down on every answer. Add `SALES_AGENT` to Snowflake Intelligence and make sure your role can see it.
2. **Use the Feedback REST API** (below). This is what any custom app does, and it's the reliable route for testing.

### 4.2 Endpoint

```
POST /api/v2/databases/{database}/schemas/{schema}/agents/{name}:feedback
```

**Headers**

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token>` |
| `X-Snowflake-Authorization-Token-Type` | `PROGRAMMATIC_ACCESS_TOKEN`, `KEYPAIR_JWT` or `OAUTH` |
| `Content-Type` | `application/json` |

**Body**

| Field | Type | Notes |
|---|---|---|
| `orig_request_id` | string | Request ID of the answer being rated. Leave it out and the feedback is logged against the agent overall. |
| `positive` | boolean | `true` = good, `false` = bad |
| `feedback_message` | string | Free text |
| `categories` | array of strings | Your own labels |
| `thread_id` | integer | Conversation thread, if you use threads |

**Success response**

```json
{ "status": "Feedback submitted successfully" }
```

### 4.3 Getting `orig_request_id`

The docs describe it as the request ID of the message you're rating, but don't say which field of the `:run` response it comes from. What the `:run` response gives you:

- The `X-Snowflake-Request-ID` response header
- Response metadata with `run_id`, `thread_id`, `user_message_id` and `assistant_message_id`

The script in 4.5 sends the `X-Snowflake-Request-ID` header value from the `:run` call as `orig_request_id`, and logs every other ID to `feedback_log.jsonl`. **Confirmed:** the `X-Snowflake-Request-ID` header value is the right one. The feedback event stores it as `RECORD_ATTRIBUTES:"ai.observability.record_id"`, and that matches the `record_id` on the `CORTEX_AGENT_REQUEST` trace of the answer you rated. There is no need to try `run_id`. In a browser app, the backend has to forward the header and expose it with CORS (`Access-Control-Expose-Headers: X-Snowflake-Request-ID`), or the page can't read it.

If you leave `orig_request_id` out, the event is logged against the agent overall (`entity_type: agent`) with no `record_id` and no `thread_id`.

### 4.4 Auth and role

- Create a programmatic access token (PAT) in Snowsight under your user profile, ideally restricted to `SALES_EVAL_ROLE`.
- The REST API runs as the token user's **default role** unless the token is restricted to a role. This is the same trap as the earlier Cortex Search "does not exist or access is not authorized" error. Either restrict the PAT to `SALES_EVAL_ROLE` or run:

```sql
ALTER USER <your_user> SET DEFAULT_ROLE = SALES_EVAL_ROLE;
```

### 4.5 Script: ask, rate, send

`agent_feedback.py` (sent alongside this doc) does the full loop: runs the agent, shows the answer, asks for thumbs up/down with categories and a comment, sends feedback, and logs everything.

```bash
pip install requests
export SNOWFLAKE_ACCOUNT_URL="https://<account_identifier>.snowflakecomputing.com"
export SNOWFLAKE_PAT="<your PAT>"

python agent_feedback.py                    # type your own questions
python agent_feedback.py --questions eval   # walk through the 8 eval questions
python agent_feedback.py --agent-level      # one rating for the agent overall
```

A session looks like this:

```
Q: What was total revenue in Q1 2026?

A (6.2s): Total revenue for Q1 2026 was 53,250.00 USD, excluding cancelled orders.
   request id: 01bf...   ids: {'run_id': '...', 'assistant_message_id': ...}
Rate it  [u]p / [d]own / [s]kip: u
Categories (comma-separated numbers, Enter to skip):
  1. Correct answer
  2. Wrong number
  ...
> 1
Comment (optional): matches the expected figure
Feedback -> 200: {"status": "Feedback submitted successfully"}
```

The categories are deliberately mapped to eval metrics. "Wrong tool" points at tool selection, "Wrong number" at the semantic view or answer correctness, and "Made something up" at the no-fabrication check.

### 4.6 curl versions

Run the agent (non-streaming) and capture the request ID header:

```bash
curl -s -D headers.txt -o run.json -X POST \
  "$SNOWFLAKE_ACCOUNT_URL/api/v2/databases/SALES_EVAL_DB/schemas/DATA/agents/SALES_AGENT:run" \
  -H "Authorization: Bearer $SNOWFLAKE_PAT" \
  -H "X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [{"role": "user", "content": [{"type": "text", "text": "What was total revenue in Q1 2026?"}]}],
        "stream": false
      }'

REQ_ID=$(grep -i '^x-snowflake-request-id' headers.txt | awk '{print $2}' | tr -d '\r')
echo "$REQ_ID"
```

Send feedback for that answer:

```bash
curl -X POST \
  "$SNOWFLAKE_ACCOUNT_URL/api/v2/databases/SALES_EVAL_DB/schemas/DATA/agents/SALES_AGENT:feedback" \
  -H "Authorization: Bearer $SNOWFLAKE_PAT" \
  -H "X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"orig_request_id\": \"$REQ_ID\",
        \"positive\": true,
        \"categories\": [\"Correct answer\"],
        \"feedback_message\": \"Matches the expected figure\"
      }"
```

Agent-level feedback, with no specific answer:

```bash
curl -X POST \
  "$SNOWFLAKE_ACCOUNT_URL/api/v2/databases/SALES_EVAL_DB/schemas/DATA/agents/SALES_AGENT:feedback" \
  -H "Authorization: Bearer $SNOWFLAKE_PAT" \
  -H "X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"positive": false, "categories": ["Too slow"], "feedback_message": "Answers take over 10 seconds"}'
```

### 4.7 Threads (optional)

For multi-turn conversations, put `thread_id` in the `:run` body with `parent_message_id: 0` on the first turn, then set `parent_message_id` to the latest `assistant_message_id` on each follow-up. Pass the same `thread_id` in the feedback body. `GET /api/v2/cortex/threads/{thread_id}` lists a thread's messages if you lose track of IDs. Single-turn testing, which is what the script does, doesn't need threads.

---

## 5. Viewing feedback

**Snowsight:** AI & ML → Agents → SALES_AGENT → Monitoring. Each thread shows its feedback.

**SQL:** feedback is stored as observability events named `CORTEX_AGENT_FEEDBACK`:

```sql
USE ROLE SALES_EVAL_ROLE;

SELECT TIMESTAMP, RECORD, RECORD_ATTRIBUTES, VALUE
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT'
))
WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK'
ORDER BY TIMESTAMP DESC;
```

#### What a feedback event contains

Seen on this account (2026-11-02). Fields come from the request body of `:feedback`.

| Field | Where | Notes |
|---|---|---|
| Rating | `VALUE:positive` (boolean) | Missing for roles without the unredacted privilege |
| Comment | `VALUE:feedback_message` | Missing for roles without the unredacted privilege |
| Categories | `VALUE:categories` (array) | Always present when sent |
| Level | `VALUE:entity_type` | `message` when `orig_request_id` was sent, `agent` when it wasn't |
| Answer | `RECORD_ATTRIBUTES:"ai.observability.record_id"` | Equals the `orig_request_id` you sent. Absent for agent-level feedback |
| Thread | `RECORD_ATTRIBUTES:"snow.ai.observability.agent.thread_id"` | Absent for agent-level feedback |
| User | `RECORD_ATTRIBUTES:"snow.ai.observability.user.name"` | |
| Role | `RECORD_ATTRIBUTES:"snow.ai.observability.role.name"` | The role the feedback was sent under |

Example, projected into columns:

```sql
SELECT
  TIMESTAMP,
  RECORD_ATTRIBUTES:"snow.ai.observability.user.name"::STRING        AS USER_NAME,
  RECORD_ATTRIBUTES:"snow.ai.observability.agent.thread_id"::STRING  AS THREAD_ID,
  RECORD_ATTRIBUTES:"ai.observability.record_id"::STRING             AS REQUEST_ID,
  VALUE:entity_type::STRING                                          AS LEVEL,
  VALUE:positive::BOOLEAN                                            AS POSITIVE,
  VALUE:feedback_message::STRING                                     AS COMMENT,
  VALUE:categories                                                   AS CATEGORIES
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(
  'SALES_EVAL_DB', 'DATA', 'SALES_AGENT', 'CORTEX AGENT'))
WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK'
ORDER BY TIMESTAMP DESC;
```

#### Redaction: rating and comment can be missing

Without `READ UNREDACTED AI OBSERVABILITY EVENTS TABLE`, the event still arrives, but `positive` and `feedback_message` are dropped from `VALUE` (not masked, just absent). Only `categories` and `entity_type` remain. This is what an app sees when its PAT runs as a role without the privilege, even if you can see the full event in Snowsight under another role. Grant it to the role the PAT uses (section 2). It was verified here: after the grant, the same SQL API query returned the rating and comment.

The Monitoring page in Snowsight shows a feedback icon whenever an event exists. The text appears only if the role you're viewing as can read unredacted events.

#### Other things seen

- Feedback given from Snowsight's own Monitoring UI uses a fixed set of categories ("Permission issue", "Response took too long", "Data source out-of-date", "Incorrect data source used") and a default comment ("Thumbs down for message"). Your own categories come only from your app.
- Feedback showed up in the events table within a minute of the API returning 200. Allow a few minutes in a sync job.
- Events can't be edited or deleted from SQL, so a test event stays in the table.

---

## 6. Turning feedback into evals

1. Each week, pull negative feedback with the section 5 query (add a filter on the positive flag once you know its field name).
2. For each real failure, write the correct answer yourself.
3. Decide where it goes:
   - The SQL was wrong: add a held-out verified query to `SALES_SV` and include it in the Analyst eval config.
   - Routing or wording was wrong: add a row to `AGENT_EVAL_DATA`.
4. New dataset rows need a new dataset version. Point a copy of the first-run config at a new `dataset_name` (e.g. `sales_agent_eval_v2`), run it once, then update the rerun config to use v2.
5. Re-run and confirm the case passes and nothing else broke.

Over time the eval set fills with real user failures instead of questions you invented.

---

## 7. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `semantic_view must be a fully qualified name in function EXECUTE_AI_EVALUATION` | Bare name in the YAML | Use `SALES_EVAL_DB.DATA.SALES_SV` / `SALES_EVAL_DB.DATA.SALES_AGENT`, rewrite the config, start with a new run name |
| `Run with name X does not exist` | DELETE or STATUS on a run that never started | Harmless for DELETE. For STATUS, check the run name |
| `Run Object: 'X' does not exists for Object: 'SYSTEM_AI_OBS_...'` | Results query uses the wrong run name | Use the run name you actually started |
| Dataset already exists on a second run | First-run config used again | Use `agent_eval_config_rerun.yaml` |
| `Cortex Search Service does not exist or access is not authorized` (or the same for the agent) over REST | REST call ran as the user's default role | Restrict the PAT to the right role, or set `DEFAULT_ROLE` |
| Feedback returns 200 but nothing in monitoring | Delay, missing read privileges, or redaction | Wait a bit, check `AI_OBSERVABILITY_READER` and the unredacted privilege |
| Event exists but has only `categories` (no rating or comment) | The reading role lacks `READ UNREDACTED AI OBSERVABILITY EVENTS TABLE` | Grant it to the role the app or PAT runs as (section 2). Snowsight may show the full event under a different role |
| Feedback is `entity_type: agent` with no thread or request id | `orig_request_id` was not sent | Forward `X-Snowflake-Request-ID` from `:run` to the browser (expose it in CORS) and send it back |
| Feedback not linked to the right answer | `orig_request_id` value | Use the `X-Snowflake-Request-ID` header value. It matches `ai.observability.record_id` on the answer's trace |
| Eval run fails on permissions despite a working session | Privileges on a secondary role | Put everything on one primary role |

---

## 8. Getting evals and feedback over the Snowflake REST API: implementation plan

The goal: your own app or job pulls eval results and user feedback out of Snowflake over HTTP, with no Snowsight and no worksheet.

### 8.1 What's available over REST

Only feedback **submission** has a dedicated endpoint. Everything else goes through the general **SQL API**, which runs any SQL statement and returns rows as JSON.

| What you want | Dedicated endpoint? | REST route | SQL it runs |
|---|---|---|---|
| Submit agent feedback | Yes | `POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:feedback` | — |
| Read agent feedback | No | `POST /api/v2/statements` | `GET_AI_OBSERVABILITY_EVENTS(...)` filtered to `CORTEX_AGENT_FEEDBACK` |
| Start or check an eval run | No | `POST /api/v2/statements` | `CALL EXECUTE_AI_EVALUATION('START' / 'STATUS', ...)` |
| Agent eval results | No | `POST /api/v2/statements` | `GET_AI_EVALUATION_DATA(...)` |
| Analyst (semantic view) eval results | No | `POST /api/v2/statements` | `GET_ANALYST_AI_EVALUATION_DATA(...)` |
| Trace for one eval record | No | `POST /api/v2/statements` | `GET_AI_RECORD_TRACE(...)` |
| Eval run errors and warnings | No | `POST /api/v2/statements` | `GET_AI_OBSERVABILITY_LOGS(...)` |
| Fetch more pages / poll a long query | — | `GET /api/v2/statements/{handle}?partition=N` | — |
| Cancel a query | — | `POST /api/v2/statements/{handle}/cancel` | — |

### 8.2 Architecture

```
          ┌────────────────────────── your side ───────────────────────────┐
          │                                                                │
 users ──▶│  chat app ──▶ agents/{name}:run                                │
          │      │                                                         │
          │      └─(thumbs)──▶ agents/{name}:feedback                      │
          │                                                                │
          │  sync job (cron / Airflow / GitHub Actions)                    │
          │      │  POST /api/v2/statements  ──▶ SNOWFLAKE.LOCAL functions │
          │      │  GET  /api/v2/statements/{handle}?partition=N           │
          │      ▼                                                         │
          │  your store (Postgres / Snowflake table / files)               │
          │      │                                                         │
          │      ▼                                                         │
          │  your API: GET /evals/{run}, GET /feedback?since=...           │
          │      │                                                         │
          │      ▼                                                         │
          │  dashboard / alerts / CI quality gate                          │
          └────────────────────────────────────────────────────────────────┘
```

Two flows:
- **Write path:** the chat app sends feedback to the `:feedback` endpoint right when the user clicks (sections 4.5 and 4.6).
- **Read path:** a sync job pulls feedback and eval results through the SQL API on a schedule, stores them, and serves them to whatever needs them.

Don't make your dashboard query Snowflake on every page load. The observability functions scan an event table and use warehouse time. Sync on a schedule and serve from your own store.

### 8.3 Phased plan

#### Phase 1: Service identity and access (half a day)

1. Create a service user for the sync job instead of using your personal login.

   ```sql
   USE ROLE ACCOUNTADMIN;
   CREATE ROLE IF NOT EXISTS CORTEX_OBS_READER;
   GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE CORTEX_OBS_READER;
   GRANT APPLICATION ROLE SNOWFLAKE.AI_OBSERVABILITY_READER TO ROLE CORTEX_OBS_READER;
   GRANT USAGE ON DATABASE SALES_EVAL_DB TO ROLE CORTEX_OBS_READER;
   GRANT USAGE ON SCHEMA SALES_EVAL_DB.DATA TO ROLE CORTEX_OBS_READER;
   GRANT MONITOR ON AGENT SALES_EVAL_DB.DATA.SALES_AGENT TO ROLE CORTEX_OBS_READER;
   GRANT MONITOR ON SEMANTIC VIEW SALES_EVAL_DB.DATA.SALES_SV TO ROLE CORTEX_OBS_READER;
   GRANT USAGE ON WAREHOUSE SALES_EVAL_WH TO ROLE CORTEX_OBS_READER;

   CREATE USER IF NOT EXISTS CORTEX_OBS_SVC
     TYPE = SERVICE
     DEFAULT_ROLE = CORTEX_OBS_READER
     DEFAULT_WAREHOUSE = SALES_EVAL_WH;
   GRANT ROLE CORTEX_OBS_READER TO USER CORTEX_OBS_SVC;
   ```

2. Pick an auth method:
   - **Key-pair JWT** is the usual choice for a service user. Generate an RSA key pair, set `RSA_PUBLIC_KEY` on the user, and sign a JWT in the job. Token type: `KEYPAIR_JWT`.
   - **PAT** is simpler while you're building. Token type: `PROGRAMMATIC_ACCESS_TOKEN`. Restrict it to `CORTEX_OBS_READER`.
   - **OAuth** if your company routes everything through an identity provider. Token type: `OAUTH`.

   Service users can't use a password. Check your account's network policy, because PATs on service users usually need one.

3. Decide whether the read role also needs to see feedback **text**. If yes, an admin grants `READ UNREDACTED AI OBSERVABILITY EVENTS TABLE` to it. Without it you get counts and positive/negative, but the comments are redacted.

4. Starting eval runs needs much more (`EXECUTE TASK`, `CREATE TASK`, `CREATE DATASET`, and so on, as in section 2). Keep that on a separate role (`SALES_EVAL_ROLE`) used only by CI, so the read-only sync job can't start runs or create objects.

**Done when:** a SQL API call as the service user returns `SELECT CURRENT_ROLE()` = `CORTEX_OBS_READER`.

#### Phase 2: SQL API client (1 day)

Build or reuse the client in `snowflake_evals_feedback_client.py`. It has to handle:

| Behavior | What the API does | What the client does |
|---|---|---|
| Fast query | `200` with rows in `data` | Return the rows |
| Slow query | `202` with `statementHandle` (no results within ~45 seconds) | Poll `GET /api/v2/statements/{handle}` until it stops returning `202` |
| Big result | `resultSetMetaData.partitionInfo` lists more than one partition | Fetch `?partition=1..N` and append |
| Column types | `rowType` gives name and type; every value comes back as a string | Convert: VARIANT/OBJECT/ARRAY → `json.loads`, timestamps (epoch strings) → ISO, numbers → int/float |
| SQL error | `422` with `code`, `message`, `sqlState` | Raise with the message, don't retry |
| Throttling / server error | `429`, `5xx` | Retry with backoff, same `requestId` |
| Timeout | `408`, or still `202` after your limit | Cancel via `/cancel` and raise |
| Context | `role`, `warehouse`, `database`, `schema` in the body | Always send them, never rely on the user's defaults |
| Inputs | `bindings` with `?` placeholders | Use binds for run names, dates and IDs, never string concatenation |

Request body the client sends:

```json
{
  "statement": "SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))",
  "timeout": 600,
  "role": "CORTEX_OBS_READER",
  "warehouse": "SALES_EVAL_WH",
  "database": "SALES_EVAL_DB",
  "schema": "DATA",
  "bindings": {
    "1": {"type": "TEXT", "value": "SALES_EVAL_DB"},
    "2": {"type": "TEXT", "value": "DATA"},
    "3": {"type": "TEXT", "value": "SALES_AGENT"},
    "4": {"type": "TEXT", "value": "agent_run_a"}
  }
}
```

Headers: `Authorization: Bearer <token>`, `X-Snowflake-Authorization-Token-Type`, `Content-Type: application/json`, `Accept: application/json`, and a `User-Agent` naming your app.

The docs flag the `bindings` format as possibly changing at GA. If a table function rejects a bound argument on your account, switch that one argument to a literal and validate the value against a strict pattern (`^[A-Za-z0-9_\-]+$` for run names) before you put it in the SQL.

**Done when:** the mocked tests pass for 200, 202 → 200, multiple partitions, 422 and 429. The client file includes the same flows I tested.

#### Phase 3: Query catalogue (half a day)

Freeze the exact SQL the job runs, all parameterized:

```sql
-- Q1. Agent feedback since a watermark (incremental)
SELECT TIMESTAMP, TRACE, RECORD, RECORD_ATTRIBUTES, VALUE
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_EVENTS(?, ?, ?, 'CORTEX AGENT'))
WHERE RECORD:name = 'CORTEX_AGENT_FEEDBACK'
  AND TIMESTAMP > TO_TIMESTAMP_NTZ(?)
ORDER BY TIMESTAMP;

-- Q2. Agent eval results for one run
SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?));

-- Q3. Agent eval summary per metric
SELECT METRIC_NAME, COUNT(*) AS RECORDS,
       ROUND(AVG(EVAL_AGG_SCORE), 3) AS AVG_SCORE, MIN(EVAL_AGG_SCORE) AS MIN_SCORE
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA(?, ?, ?, 'CORTEX AGENT', ?))
GROUP BY METRIC_NAME;

-- Q4. Semantic view eval results for one run
SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_ANALYST_AI_EVALUATION_DATA(?, ?, ?, 'SEMANTIC VIEW', ?));

-- Q5. Trace for one record
SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_RECORD_TRACE(?, ?, ?, 'CORTEX AGENT', ?));

-- Q6. Errors and warnings for a run
SELECT TIMESTAMP, RECORD, RECORD_ATTRIBUTES, VALUE
FROM TABLE(SNOWFLAKE.LOCAL.GET_AI_OBSERVABILITY_LOGS(?, ?, ?, 'CORTEX AGENT'))
WHERE RECORD:"severity_text" IN ('ERROR', 'WARN')
  AND RECORD_ATTRIBUTES:"snow.ai.observability.run.name" = ?;

-- Q7 / Q8. Start and check a run (CI role only)
CALL EXECUTE_AI_EVALUATION('START',  OBJECT_CONSTRUCT('run_name', ?), ?);
CALL EXECUTE_AI_EVALUATION('STATUS', OBJECT_CONSTRUCT('run_name', ?), ?);
```

Run each one once in a worksheet as the service role and save a sample of the output. You need it for Phase 4, because the field names inside the feedback event (`RECORD_ATTRIBUTES`, `VALUE`) aren't fully documented. Look at real rows before you map them.

There's no function that lists all eval runs. Keep your own run registry: whoever starts a run (CI, a person) writes the run name, config path, kind (agent or Analyst) and start time to it. The sync job reads the registry to know which runs to pull.

**Done when:** every query returns rows as the service role, and you have one saved sample per query.

#### Phase 4: Storage model (half a day)

Store normalized rows and keep the raw JSON alongside, since the event format can change.

```sql
-- Wherever you store it: Postgres, or a Snowflake table in your own schema
CREATE TABLE agent_feedback (
  event_ts          TIMESTAMP     NOT NULL,
  trace_id          VARCHAR,
  request_id        VARCHAR,
  thread_id         VARCHAR,
  user_name         VARCHAR,
  positive          BOOLEAN,
  categories        JSON,          -- VARIANT in Snowflake
  feedback_message  TEXT,
  raw_event         JSON,
  loaded_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_ts, trace_id)
);

CREATE TABLE eval_runs (           -- the run registry
  run_name     VARCHAR PRIMARY KEY,
  kind         VARCHAR,            -- 'agent' or 'analyst'
  target       VARCHAR,            -- SALES_AGENT or SALES_SV
  config_path  VARCHAR,
  started_at   TIMESTAMP,
  status       VARCHAR,
  synced_at    TIMESTAMP
);

CREATE TABLE eval_results (
  run_name        VARCHAR,
  record_id       VARCHAR,
  metric_name     VARCHAR,
  input           TEXT,
  output          TEXT,
  ground_truth    TEXT,
  eval_agg_score  FLOAT,
  duration_ms     NUMBER,
  raw_row         JSON,
  PRIMARY KEY (run_name, record_id, metric_name)
);

CREATE TABLE sync_state (
  stream          VARCHAR PRIMARY KEY,   -- 'agent_feedback'
  watermark_ts    TIMESTAMP
);
```

- Analyst eval rows have no `METRIC_NAME` or `RECORD_ID`. Store them with metric `sql_correctness` and use the question text (or its hash) as the record ID.
- Feedback is append-only in Snowflake (entries can't be modified), which makes incremental loads straightforward.

**Done when:** sample rows from Phase 3 load into the tables without errors.

#### Phase 5: Sync job (1 day)

```
every 15 min:
  1. feedback
       wm   = sync_state['agent_feedback'] or '1970-01-01'
       rows = Q1(since = wm - 10 min)        # overlap catches late-arriving events
       upsert rows into agent_feedback       # primary key removes the overlap duplicates
       sync_state['agent_feedback'] = max(event_ts)

  2. evals
       for run in eval_runs where synced_at is null:
           status = Q8(run)
           if finished:
               rows = Q2 (agent) or Q4 (analyst)
               upsert rows into eval_results
               mark run synced, store status
           elif errored:
               store Q6 output, mark failed
```

Why the 10-minute overlap: feedback events can take a few minutes to land, so a strict "greater than last watermark" would skip some. The primary key handles the duplicates.

Sketch using the client:

```python
from snowflake_evals_feedback_client import SnowflakeSQLClient, CortexObservability

obs = CortexObservability(SnowflakeSQLClient(ACCOUNT_URL, TOKEN, "KEYPAIR_JWT",
                                             role="CORTEX_OBS_READER"))

def sync_feedback(store):
    wm = store.get_watermark("agent_feedback") or "1970-01-01 00:00:00"
    since = (parse(wm) - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
    rows = obs.feedback(since=since)
    store.upsert_feedback(rows)
    if rows:
        store.set_watermark("agent_feedback", max(r["timestamp"] for r in rows))

def sync_evals(store):
    for run in store.unsynced_runs():
        status = obs.eval_status(run.name, run.config_path)
        if not looks_finished(status):
            continue
        rows = (obs.agent_eval_results(run.name) if run.kind == "agent"
                else obs.analyst_eval_results(run.name))
        store.upsert_eval_results(run.name, rows)
        store.mark_synced(run.name, status)
```

Schedule it with whatever you already run: cron, Airflow, a GitHub Actions schedule, or an Azure Function timer.

**Done when:** two consecutive runs load new feedback without duplicates, and a finished eval run shows up in `eval_results` within one cycle.

#### Phase 6: Your own read API (1 day, optional)

If a front end or other teams need this data, put a thin API in front of your store, not in front of Snowflake:

| Your endpoint | Returns | Backed by |
|---|---|---|
| `GET /feedback?since=&positive=&category=` | Feedback list | `agent_feedback` |
| `GET /feedback/summary?days=7` | Counts by day, positive rate, top categories | `agent_feedback` |
| `GET /evals/runs` | Runs with status and averages | `eval_runs` + `eval_results` |
| `GET /evals/runs/{run}` | Per-question, per-metric scores | `eval_results` |
| `GET /evals/runs/{run}/compare/{other}` | Metric deltas, questions that went from pass to fail | `eval_results` |
| `GET /evals/records/{record_id}/trace` | Live trace | Q5 through the SQL API (on demand, cached) |
| `POST /evals/runs` | Starts a run (CI only, separate auth) | Q7 through the SQL API with the CI role |

FastAPI sketch:

```python
from fastapi import FastAPI, Query

app = FastAPI()

@app.get("/feedback")
def list_feedback(since: str | None = None, positive: bool | None = None):
    return store.query_feedback(since=since, positive=positive)

@app.get("/evals/runs/{run_name}")
def eval_run(run_name: str):
    return {"summary": store.metric_summary(run_name),
            "records": store.eval_records(run_name)}

@app.get("/evals/records/{record_id}/trace")
def trace(record_id: str):
    return cache.get_or_set(f"trace:{record_id}", lambda: obs.record_trace(record_id), ttl=3600)
```

#### Phase 7: Alerts and quality gates (half a day)

- **CI gate:** after a PR changes the semantic view or agent spec, CI starts a run (Q7), waits for it (`wait-eval`), pulls the summary (Q3), and fails the build if, for example, `answer_correctness` drops more than 0.05 below the baseline or any question that passed now fails.
- **Feedback alert:** if the negative rate over the last 24 hours goes above a threshold, or the same category ("Wrong number") shows up more than N times, post to Teams/Slack with links to the threads.
- **Weekly digest:** top negative feedback with the agent's actual answers. This is the input for section 6 (turning feedback into eval rows).

#### Phase 8: Testing (half a day)

| Test | How |
|---|---|
| Client protocol | Mock HTTP: 200, 202 → 200, multiple partitions, 422, 429 retry, timeout + cancel |
| Type conversion | VARIANT, timestamp_ntz epoch strings, NULLs, numbers with decimals |
| Feedback mapping | Run against the saved Phase 3 samples, check every field maps |
| Watermark | Two runs with overlapping events, check there are no duplicates and no gaps |
| End to end | Send a thumbs-down with `agent_feedback.py`, wait, run the sync, find it in `agent_feedback` |
| Permissions | Run as `CORTEX_OBS_READER`: reads work, `EXECUTE_AI_EVALUATION('START', ...)` fails |

#### Phase 9: Operations

- **Cost:** each sync uses the warehouse for a few seconds. Keep it XSMALL with a 60-second auto-suspend. A 15-minute schedule is plenty for feedback.
- **Tagging:** set `parameters.query_tag` in the SQL API body (e.g. `cortex_obs_sync`) so these queries are easy to find in query history.
- **Secrets:** keep the private key or PAT in a vault (Azure Key Vault, AWS Secrets Manager), never in code. Rotate PATs before they expire.
- **Data handling:** feedback text can contain anything a user typed. If you load unredacted text into your own store, apply the same access controls you'd use for the chat logs.
- **Format drift:** the observability event format isn't a stable contract. Keep `raw_event` and alert if the normalized fields start coming back empty.

### 8.4 Using the reference client

`snowflake_evals_feedback_client.py` implements Phase 2 and the Phase 3 queries, with a CLI for checking things by hand:

```bash
pip install requests
export SNOWFLAKE_ACCOUNT_URL="https://<account_identifier>.snowflakecomputing.com"
export SNOWFLAKE_PAT="<token>"
export SF_ROLE="SALES_EVAL_ROLE"          # or CORTEX_OBS_READER once Phase 1 is done

# Feedback since a time (UTC)
python snowflake_evals_feedback_client.py feedback --since "2026-11-01 00:00:00"

# Agent eval: per-metric summary, then full rows to a file
python snowflake_evals_feedback_client.py agent-eval-summary agent_run_a
python snowflake_evals_feedback_client.py --out agent_run_a.json agent-eval agent_run_a

# Semantic view eval results
python snowflake_evals_feedback_client.py analyst-eval sv_run_a

# Trace and errors
python snowflake_evals_feedback_client.py trace <record_id>
python snowflake_evals_feedback_client.py eval-logs agent_run_a

# Start a run and wait for it (needs the CI role)
python snowflake_evals_feedback_client.py start-eval agent_run_d @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml
python snowflake_evals_feedback_client.py wait-eval  agent_run_d @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml
```

Feedback comes back normalized:

```json
{
  "timestamp": "2026-11-02T05:30:00+00:00",
  "positive": false,
  "feedback_message": "Revenue looks like it includes cancelled orders",
  "categories": ["Wrong number"],
  "user": "DSK",
  "request_id": "...",
  "thread_id": null,
  "raw": { "record": {}, "attributes": {}, "value": {}, "trace": {} }
}
```

`normalize_feedback` finds fields by matching key-name endings (`positive`, `feedback_message`, `categories`, and so on). The exact names are now known (section 5): `VALUE:positive`, `VALUE:feedback_message`, `VALUE:categories`, `VALUE:entity_type`, and in `RECORD_ATTRIBUTES` the keys `ai.observability.record_id`, `snow.ai.observability.agent.thread_id` and `snow.ai.observability.user.name`. The suffix matching works for these. `request_id` is read from `ai.observability.record_id` (both clients also match `record_id` for that reason).

`wait_for_eval` treats a run as finished when the STATUS output contains a word like COMPLETED or FAILED and no longer says RUNNING or IN_PROGRESS. Once you've seen a real STATUS result, replace that with a check on the actual status column.

### 8.5 Timeline

| Phase | Effort |
|---|---|
| 1. Service identity and access | 0.5 day |
| 2. SQL API client | 1 day (mostly done in the reference client) |
| 3. Query catalogue + samples | 0.5 day |
| 4. Storage model | 0.5 day |
| 5. Sync job | 1 day |
| 6. Read API (optional) | 1 day |
| 7. Alerts and CI gate | 0.5 day |
| 8. Testing | 0.5 day |
| **Total** | **about 5 days**, 4 without the read API |

### 8.6 Checklist

- [ ] Service user + `CORTEX_OBS_READER` role created, auth working
- [ ] `SELECT CURRENT_ROLE()` over the SQL API returns the right role
- [ ] Feedback text visible (unredacted privilege granted, if you need the text)
- [ ] All query catalogue SQL tested as the service role, samples saved
- [ ] Feedback field mapping updated from real samples
- [ ] Run registry in place; CI writes to it when it starts a run
- [ ] Sync job scheduled, watermark overlap working, no duplicates
- [ ] CI gate thresholds agreed and wired up
- [ ] Feedback alert going to the right channel
- [ ] Secrets in a vault, `query_tag` set

---

## Sources

- [Cortex Agent evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations)
- [Cortex Agents Feedback REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-feedback-rest-api)
- [Cortex Agents Run API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-run)
- [Cortex Agent threads](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads)
- [Monitor Cortex Agent requests](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor)
- [GET_AI_OBSERVABILITY_EVENTS](https://docs.snowflake.com/sql-reference/functions/get_ai_observability_events-snowflake-local)
- [Snowflake SQL API reference](https://docs.snowflake.com/en/developer-guide/sql-api/reference)
- [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations)
