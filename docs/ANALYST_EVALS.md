# Cortex Analyst evaluations (semantic views)

How to evaluate a semantic view with Cortex Analyst evals, and how the app's **Evaluations & Feedback → Analyst (semantic view)** tab drives it.

Agent evals are covered in [cortex_agent_evals_and_feedback.md](../cortex_agent_evals_and_feedback.md). Analyst evals use the same `EXECUTE_AI_EVALUATION` procedure but differ in what is measured, the config file, and the results function.

Source: [Cortex Analyst evaluations](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst-evaluations), read 2026-11-03. Snowflake recommends moving to Cortex Agents, which the page says supports every Cortex Analyst capability.

---

## 1. What it measures

| | Analyst eval | Agent eval |
|---|---|---|
| Target | A semantic view | A Cortex Agent |
| Ground truth | The view's **verified queries** (question + expected SQL) | A dataset table you build (`ground_truth_output`, `ground_truth_invocations`) |
| Metric | `sql_correctness` only | `answer_correctness`, `logical_consistency`, `tool_selection_accuracy`, `tool_execution_accuracy`, custom |
| How it scores | Runs the SQL Cortex Analyst generates and a judge compares its results to the verified query's | LLM judge against your ground truth |
| Also reported | Regressions (passed before, fails now) and latency | |

During a run, Cortex Analyst works against a temporary copy of the view with the selected verified queries removed, so it cannot look the answer up. Verified queries you don't select stay in the view and still guide generation. A verified query is either guidance or ground truth, never both in the same run.

**Limits:** one semantic view per run, no multi-turn, no auto-generated datasets. Use absolute dates in verified-query questions, because relative ones ("last 30 days") drift.

---

## 2. Prerequisites

Everything must sit on **one primary role**, because runs execute as tasks and ignore secondary roles.

- Database role `SNOWFLAKE.CORTEX_USER`
- `USE AI FUNCTIONS` (granted to `PUBLIC` by default; grant it explicitly if revoked)
- `EXECUTE TASK ON ACCOUNT`
- `CREATE TASK` and `CREATE DATASET` on the schema holding the semantic view
- `SELECT` on the semantic view and the tables it uses
- `MONITOR` on the semantic view
- `READ` on the config stage
- At least one **verified query** on the view (added in Semantic Studio)

`SALES_EVAL_ROLE` already has these for `SALES_EVAL_DB.DATA.SALES_SV`.

To read the results in the app, the role also needs what section 2 of the agent doc lists for reading traces and feedback.

---

## 3. The config file

```yaml
evaluation:
  analyst_params:
    analyst_name: "SALES_EVAL_DB.DATA.SALES_SV"
    analyst_type: "SEMANTIC VIEW"
  source_metadata:
    type: "verified_queries"
    # Optional. Question texts exactly as written in the verified queries.
    # Omit the list to use all of them.
    verified_queries:
      - "Who are the top 3 customers by revenue?"
      - "What was total revenue in Q1 2026?"

metrics:
  - name: "sql_correctness"
    version: "v3"
```

| Key | Notes |
|---|---|
| `analyst_params.analyst_name` | The semantic view. Snowflake's example uses a bare name. See "Assumptions" below. |
| `analyst_params.analyst_type` | Always `SEMANTIC VIEW` |
| `source_metadata.type` | Only `verified_queries` is supported |
| `source_metadata.verified_queries` | Optional list of question texts. All verified queries if omitted |
| `metrics[].version` | `v1`, `v2`, `v3`, or `v<major>_<minor>` to freeze a minor version |

**Metric versions.** `v1` uses the `claude-4-sonnet` judge, which entered the legacy state on 2026-08-12, so an account with no earlier use of that model must pin `v2` or `v3`. Pin a version for scheduled or CI runs, and don't compare scores across versions.

There is no separate "first run" and "rerun" config like the agent evals have, because no dataset is registered.

Keep the YAML uncompressed when uploading (`PUT ... AUTO_COMPRESS=false`).

### Writing it to a stage

From a worksheet, with the helper procedure from the setup script:

```sql
CALL SALES_EVAL_DB.DATA.WRITE_TO_STAGE(
  '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/analyst_eval_config.yaml',
$$evaluation:
  analyst_params:
    analyst_name: "SALES_EVAL_DB.DATA.SALES_SV"
    analyst_type: "SEMANTIC VIEW"
  source_metadata:
    type: "verified_queries"
metrics:
  - name: "sql_correctness"
    version: "v3"
$$);
```

The app can do this for you (section 6).

---

## 4. Run it

Every run needs a unique name.

```sql
CALL EXECUTE_AI_EVALUATION('START',  OBJECT_CONSTRUCT('run_name', 'sv_run_a'), '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/analyst_eval_config.yaml');
CALL EXECUTE_AI_EVALUATION('STATUS', OBJECT_CONSTRUCT('run_name', 'sv_run_a'), '@SALES_EVAL_DB.DATA.EVAL_CONFIGS/analyst_eval_config.yaml');
```

`CANCEL` and `DELETE` take the same arguments. `START`, `CANCEL` and `DELETE` return a message string. `STATUS` returns one row:

| Column | Meaning |
|---|---|
| `RUN_NAME` | The run |
| `AGENT_NAME`, `AGENT_TYPE` | Documented as agent fields. Whether they are filled for Analyst runs isn't stated |
| `STATUS` | See below |
| `STATUS_DETAILS` | Array of error messages from the run |

| `STATUS` | Meaning |
|---|---|
| `CREATED` | Created, not started |
| `INVOCATION_IN_PROGRESS` | Generating output and traces |
| `INVOCATION_COMPLETED` | Output and traces created |
| `INVOCATION_PARTIALLY_COMPLETED` | Partial failures while generating |
| `COMPUTATION_IN_PROGRESS` | Computing the metric |
| `COMPLETED` | Done |
| `PARTIALLY_COMPLETED` | Partial failures while computing the metric |
| `CANCELLED` | Cancelled |

A run is only finished at `COMPLETED`, `PARTIALLY_COMPLETED` or `CANCELLED`. `INVOCATION_COMPLETED` is an intermediate step.

---

## 5. Read the results

```sql
SELECT * FROM TABLE(SNOWFLAKE.LOCAL.GET_ANALYST_AI_EVALUATION_DATA(
  'SALES_EVAL_DB', 'DATA', 'SALES_SV', 'SEMANTIC VIEW', 'sv_run_a'));
```

One row per verified query:

| Column | Meaning |
|---|---|
| `RECORD_ID`, `INPUT_ID`, `REQUEST_ID` | Identifiers |
| `TIMESTAMP` | When the request was made |
| `DURATION_MS` | Time Cortex Analyst took to respond |
| `INPUT` | The question |
| `OUTPUT` | Cortex Analyst's response |
| `ERROR` | Errors during the request |
| `GROUND_TRUTH` | The expected result used to judge the output |
| `METRIC_NAME` | `sql_correctness` |
| `EVAL_AGG_SCORE` | The score for this record |
| `METRIC_TYPE` | `system` or `custom` |
| `METRIC_STATUS` | Map with `status` (HTTP code) and `message` |
| `METRIC_CALLS` | Array with `criteria` and `explanation` (details of the compared result sets) |

These rows do have `METRIC_NAME` and `RECORD_ID`.

**Snowsight:** AI & ML → Cortex Analyst → the semantic view → Evaluations. It shows accuracy, regressions, average and per-query latency, and per-query expected SQL against generated SQL, with an **Improve** button that starts semantic view optimization.

**Cost:** warehouse time for the queries, evaluation credits for the judge (the rate depends on the metric version), and storage. Judge calls show in `CORTEX_REST_API_USAGE_HISTORY`.

**Reading scores.** Failures here point at SQL generation, so fix them in the semantic view: comments, synonyms, custom instructions, and guidance verified queries. Run the same config about three times before trusting a number, and compare against a baseline run rather than judging a score alone.

---

## 6. Using it in the app

Open **Evaluations & Feedback → Analyst (semantic view)**, pick the view, then:

1. **Create the config from this form** (on by default). Choose the stage, the `sql_correctness` version (v3 by default), and optionally list the verified-query questions to evaluate, one per line. The app writes `<stage>/<run name>.yaml`, then starts the run.
   Turn the switch off to use a config file that already exists, or to track a run started elsewhere.
2. The run appears in the table. Runs in progress refresh every 30 seconds, and you can check status or cancel by hand. If Snowflake reports errors for a run, they are shown above the table.
3. Open **Results** for the headline numbers (SQL correctness, queries evaluated, queries below 0.7, average response time), the per-query grid, and a **Details** button per query with the expected SQL, the response and the judge's explanation.
4. Use **Compare with** to diff two finished runs: average change per metric, plus the questions that **regressed** (passed in the baseline, fail now) and **improved**.

Backend routes (all under `/api/semantic-views/:view/evals`): `GET/POST runs`, `DELETE runs/:run`, `GET runs/:run/status`, `POST runs/:run/cancel`, `GET runs/:run`. The same routes exist under `/api/agents/:agent/evals`, with run logs and record traces added for agents.

The app only reads semantic views in the database and schema the backend is configured for.

### Settings

| Variable | Purpose |
|---|---|
| `SNOWFLAKE_WAREHOUSE` | Required. Starting and reading evals needs a running warehouse |
| `SNOWFLAKE_EVAL_ROLE` | Role for the eval SQL (needs the privileges in section 2) |
| `EVAL_CONFIG_STAGE` | Stage offered for generated configs. Default `@<DATABASE>.<SCHEMA>.EVAL_CONFIGS` |
| `EVAL_WRITE_TO_STAGE_PROC` | Helper procedure that writes YAML to a stage. Default `<DATABASE>.<SCHEMA>.WRITE_TO_STAGE` |
| `EVAL_RUNS_FILE` | Where tracked runs are kept. Default `server/.data/eval_runs.json` |

---

## 7. Assumptions to check on your account

The app was built from Snowflake's documentation. These points are not confirmed by it, and none have been run against your account yet:

1. **Fully qualified `analyst_name`.** The docs show a bare name. The app writes `DATABASE.SCHEMA.VIEW`, because EXECUTE_AI_EVALUATION rejected bare names for semantic views in an earlier test ("must be a fully qualified name"). If a run rejects the qualified name, try the bare one.
2. **Score scale.** The docs don't define the range of `EVAL_AGG_SCORE`. The app treats scores below 0.7 as weak and shows the average as a percentage. Check what values real runs return.
3. **`WRITE_TO_STAGE`.** Config generation needs the helper procedure from the setup script. Without it, upload the YAML yourself and turn the switch off.
4. **Warehouse.** Reads fail with "Warehouse is suspended" if `COMPUTE_WH` has auto-resume off. Resume it or turn auto-resume on.

## 8. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Warehouse 'X' is suspended` | Auto-resume is off | `ALTER WAREHOUSE X RESUME` (or enable auto-resume) |
| `File does not exist or not authorized for file '@...'` | Wrong stage path, or no `READ` on the stage | Check with `LIST @stage`. Names in `LIST` start with the stage name, which is not a subfolder |
| `must be a fully qualified name` | Bare object name in the config | Use `DATABASE.SCHEMA.OBJECT`, rewrite the file, use a new run name |
| `Run Object: 'X' does not exists for Object: 'Y'` | The run was never started, or the view name is wrong | Check the run name and the view |
| Run is `PARTIALLY_COMPLETED` | Some verified queries failed | Read `STATUS_DETAILS` and the per-query `ERROR` and `METRIC_STATUS` |
| `claude-4-sonnet` not available | `v1` judge is legacy | Pin `v2` or `v3` |
| Run fails on permissions despite a working session | Privileges on a secondary role | Put everything on one primary role |
