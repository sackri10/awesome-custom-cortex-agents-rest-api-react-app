# Cortex Agents — Management, APIs, YAML & Sessions

A reference for how this app creates, edits, lists, and talks to Snowflake Cortex
Agents, plus the semantic-view / Cortex-Search endpoints, YAML export/deploy, and
how conversation sessions actually work.

> **Architecture in one line:** the React frontend never calls Snowflake directly.
> It calls a small Express **backend proxy** (`server/server.js`), which holds the
> Programmatic Access Token (PAT) and forwards to Snowflake. The PAT is never
> exposed to the browser.
>
> ```
> Browser (React)  ──HTTP──▶  Backend proxy (Express, :3001)  ──HTTPS + PAT──▶  Snowflake REST APIs
> ```

All Snowflake calls use these auth headers on the server:

```http
X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN
Authorization: Bearer <SNOWFLAKE_PAT>
Content-Type: application/json
Accept: application/json
```

The backend is configured for **one** environment via `.env`:
`SNOWFLAKE_HOST`, `SNOWFLAKE_PAT`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`, and
(optional) `SNOWFLAKE_WAREHOUSE`.

---

## 1. Endpoint map

| App action | Proxy endpoint (this app) | Snowflake endpoint (what the proxy calls) |
|---|---|---|
| List agents | `GET /api/agents` | `GET /api/v2/databases/{db}/schemas/{schema}/agents` |
| **Fetch agent for edit** | `GET /api/agents/:name` | `GET /api/v2/databases/{db}/schemas/{schema}/agents/{name}` |
| **Create agent** | `POST /api/agents` | `POST /api/v2/databases/{db}/schemas/{schema}/agents?createMode=…` |
| **Update / edit agent** | `PUT /api/agents/:name` | `PUT /api/v2/databases/{db}/schemas/{schema}/agents/{name}` |
| Chat with agent | `POST /api/agents/:name/messages` | `POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:run` |
| Create conversation thread | `POST /api/threads` | `POST /api/v2/cortex/threads` |
| Describe thread (history) | `GET /api/threads/:id` | `GET /api/v2/cortex/threads/{id}` |
| List semantic views | `GET /api/semantic-views` | SQL API: `SHOW SEMANTIC VIEWS IN SCHEMA …` |
| Create semantic view | `POST /api/semantic-views` | SQL API: `CREATE SEMANTIC VIEW …` |
| List search services | `GET /api/cortex-search-services` | SQL API: `SHOW CORTEX SEARCH SERVICES IN SCHEMA …` |
| Create search service | `POST /api/cortex-search-services` | SQL API: `CREATE CORTEX SEARCH SERVICE …` |
| Databases / schemas / tables / columns | `GET /api/metadata/*` | SQL API: `SHOW DATABASES / SCHEMAS / OBJECTS / COLUMNS` |
| Server context | `GET /api/context` | (local — returns configured db/schema/warehouse) |

The "SQL API" is Snowflake's statement-execution endpoint: `POST /api/v2/statements`
with body `{ "statement": "...", "timeout": 60, "database": "...", "schema": "...", "warehouse": "..." }`.

---

## 2. Fetching an agent (edit prefill)

**Endpoint:** `GET /api/agents/:name` → Snowflake `GET …/agents/{name}`

The response describes the agent. The full configuration lives in **`agent_spec`,
a JSON *string*** (you must `JSON.parse` it). `profile` is also a JSON string.

```json
{
  "name": "SALES_CONVERSATION_AGENT",
  "database_name": "SALES_INTELLIGENCE",
  "schema_name": "DATA",
  "owner": "ACCOUNTADMIN",
  "created_on": "2026-07-18T18:12:16.438+00:00",
  "comment": null,
  "profile": "{\"display_name\":\"my_sales_agent\"}",
  "agent_spec": "{\"models\":{...},\"instructions\":{...},\"tools\":[...],\"tool_resources\":{...}}"
}
```

### The `agent_spec` structure (after `JSON.parse`)

```jsonc
{
  "models": {
    "orchestration": "claude-sonnet-4-5"        // orchestration model ("auto" lets Snowflake pick)
  },
  "instructions": {
    "response":      "How the agent should phrase answers…",
    "orchestration": "How the agent should plan / choose tools…",
    "system":        "Persona / hard rules…",
    "sample_questions": [ { "question": "What was revenue last quarter?" } ]
  },
  "tools": [
    { "tool_spec": { "type": "cortex_search",              "name": "ConversationSearch", "description": "…" } },
    { "tool_spec": { "type": "cortex_analyst_text_to_sql", "name": "SalesAnalyst",       "description": "…" } }
  ],
  "tool_resources": {
    "ConversationSearch": { "name": "SALES_INTELLIGENCE.DATA.SALES_CONVERSATION_SEARCH", "max_results": "5" },
    "SalesAnalyst": {
      "semantic_model_file": "@SALES_INTELLIGENCE.DATA.MODELS/sales_metrics_model.yaml",
      "execution_environment": { "type": "warehouse", "warehouse": "COMPUTE_WH", "query_timeout": 60 }
    }
  }
}
```

**Key rule:** every `tools[].tool_spec.name` must have a matching key in
`tool_resources`. That mapping is how a tool is wired to its data source.

### `tool_resources` shapes (both tool types)

**Cortex Analyst** (`cortex_analyst_text_to_sql`) — one of:

```jsonc
// (a) native semantic view object
{ "semantic_view": "DB.SCHEMA.MY_VIEW" }

// (b) semantic model file (a YAML on a stage) — often with an execution environment
{
  "semantic_model_file": "@DB.SCHEMA.STAGE/model.yaml",
  "execution_environment": { "type": "warehouse", "warehouse": "MY_WH", "query_timeout": 60 }
}
```

**Cortex Search** (`cortex_search`):

```jsonc
{
  "name": "DB.SCHEMA.MY_SEARCH_SERVICE",   // stored form (Snowflake UI writes `name`)
  // "search_service": "DB.SCHEMA.…",      // equivalent field seen in some docs
  "max_results": "5",
  "id_column": "ID",                        // optional
  "title_column": "TITLE"                   // optional
}
```

### How edit mode uses this (in the app)

1. `GET /api/agents/:name` → `JSON.parse(agent_spec)`.
2. Prefill the form: `models.orchestration`, `instructions.*`, `sample_questions`,
   `profile.display_name`, `comment`.
3. Split `tools` into the two pickers:
   - Analyst tools → value = `semantic_view` **or** `semantic_model_file`.
   - Search tools → value = `name` **or** `search_service`.
   - Any **other** tool type is preserved verbatim in the "Advanced JSON" box.
4. **Preserve fidelity:** the original `tool_spec` + resource for each existing tool
   is captured and re-emitted **unchanged** on save, so fields the UI doesn't model
   (`execution_environment`, `max_results`, `semantic_model_file`, id/title columns)
   are never silently dropped. Only newly-added objects get freshly-generated
   minimal resources.
5. Save → `PUT /api/agents/:name` (see below). The agent **name is locked** (it's the
   object identifier and can't be renamed via update).

---

## 3. Creating an agent

**Endpoint:** `POST /api/agents` → Snowflake `POST …/agents?createMode=errorIfExists|orReplace`

`createMode` (passed by the app as a `_createMode` field the backend strips off and
turns into the query param):
- `errorIfExists` (default) — fail if an agent with that name already exists (409).
- `orReplace` — overwrite an existing agent.

**Request body** (the Cortex Agent object; only `name` is required):

```jsonc
{
  "name": "my_sales_agent",                 // required, valid identifier
  "comment": "Answers sales questions",
  "profile": { "display_name": "Sales Agent" },
  "models": { "orchestration": "claude-4-sonnet" },
  "instructions": {
    "response": "Be concise and friendly.",
    "orchestration": "Use SalesAnalyst for metrics.",
    "system": "Only answer sales questions.",
    "sample_questions": [ { "question": "Top deals this quarter?" } ]
  },
  "tools": [
    { "tool_spec": { "type": "cortex_analyst_text_to_sql", "name": "SalesAnalyst",
                     "description": "Queries sales metrics" } }
  ],
  "tool_resources": {
    "SalesAnalyst": { "semantic_view": "SALES_INTELLIGENCE.PUBLIC.SALES_SV" }
  }
}
```

On success Snowflake returns `200` (sometimes with an empty body — the proxy
normalizes this to `{ "status": "Agent … successfully created." }`).

---

## 4. Updating (editing) an agent

**Endpoint:** `PUT /api/agents/:name` → Snowflake `PUT …/agents/{name}`

- The **name is in the URL**; the body is the **full spec** to replace it with
  (same field shape as create: `comment`, `profile`, `models`, `instructions`,
  `tools`, `tool_resources`). No `createMode`.
- PUT is a **full replacement** — send the complete spec, not a partial patch. This
  is why the app preserves and re-sends unmodeled fields (see §2, step 4).
- Snowflake returns `200` with an **empty body** on success; the proxy normalizes it
  to `{ "status": "Agent … successfully updated." }`.

> **Verified round-trip:** fetching an agent, reconstructing its spec, and PUTting it
> back returns `200 "successfully updated"` with `execution_environment`,
> `max_results`, and `semantic_model_file` all intact.

**Rebinding a YAML model file to a native semantic view (edit-only helper):** the app
can swap `semantic_model_file` → `semantic_view` while keeping the tool's `name`,
`description`, and `execution_environment`. It cannot edit the YAML *content* on the
stage (see §6).

---

## 5. Semantic views & Cortex Search — endpoints

These do **not** have first-class create/list REST endpoints used here; instead the
proxy runs SQL through the **SQL API** (`POST /api/v2/statements`). `SHOW` commands
need no warehouse; `CREATE` commands do (hence optional `SNOWFLAKE_WAREHOUSE`).

### List

| Endpoint | SQL executed |
|---|---|
| `GET /api/semantic-views?database=&schema=` | `SHOW SEMANTIC VIEWS IN SCHEMA <db>.<schema>` |
| `GET /api/cortex-search-services?database=&schema=` | `SHOW CORTEX SEARCH SERVICES IN SCHEMA <db>.<schema>` |

Both default to the configured db/schema and return normalized rows:

```json
{ "data": [ { "name": "TEST", "database_name": "SALES_INTELLIGENCE",
              "schema_name": "PUBLIC", "comment": "", "created_on": "…",
              "fqn": "SALES_INTELLIGENCE.PUBLIC.TEST" } ] }
```

> Objects can live in **any** schema, so the picker exposes database + schema
> selectors backed by `GET /api/metadata/databases` and `GET /api/metadata/schemas`.

### Create — Cortex Search service

**Endpoint:** `POST /api/cortex-search-services` (requires `SNOWFLAKE_WAREHOUSE`).
The backend builds the DDL from structured input (identifiers validated, never
string-injected):

```sql
CREATE [OR REPLACE] CORTEX SEARCH SERVICE <db>.<schema>.<name>
  ON <search_column>
  ATTRIBUTES <col>, <col>
  WAREHOUSE = <warehouse>
  TARGET_LAG = '1 hour'
  [ EMBEDDING_MODEL = 'snowflake-arctic-embed-l-v2.0' ]
  [ COMMENT = '…' ]
AS ( SELECT col1, col2 FROM <db>.<schema>.<table> );
```

Request body: `{ name, database?, schema?, orReplace?, searchColumn, attributes[],
warehouse, targetLag, embeddingModel?, comment?, query }`.

### Create — semantic view

**Endpoint:** `POST /api/semantic-views` (warehouse not strictly required — pure
metadata DDL). The backend assembles:

```sql
CREATE [OR REPLACE] SEMANTIC VIEW <db>.<schema>.<name>
  TABLES ( <alias> AS <db.schema.table> PRIMARY KEY (…) WITH SYNONYMS = (…) COMMENT = '…', … )
  RELATIONSHIPS ( <rel> AS <alias> (<col>) REFERENCES <alias> (<col>), … )
  FACTS ( <alias>.<name> AS <sql_expr> …, … )
  DIMENSIONS ( <alias>.<name> AS <sql_expr> WITH SYNONYMS = (…) …, … )
  METRICS ( <alias>.<name> AS <agg_expr> …, … )
  COMMENT = '…';
```

Request body mirrors those clauses: `{ name, database?, schema?, orReplace?, comment?,
tables[], relationships[], dimensions[], metrics[], facts[] }`. Column lists and SQL
expressions are free text (semantic expressions are SQL); object/column identifiers
are validated.

### Metadata (for the builder pickers)

| Endpoint | SQL |
|---|---|
| `GET /api/metadata/databases` | `SHOW DATABASES` |
| `GET /api/metadata/schemas?database=` | `SHOW SCHEMAS IN DATABASE <db>` |
| `GET /api/metadata/tables?database=&schema=` | `SHOW OBJECTS IN SCHEMA <db>.<schema>` (tables + views) |
| `GET /api/metadata/columns?database=&schema=&table=` | `SHOW COLUMNS IN TABLE <db>.<schema>.<table>` |

---

## 6. YAML — how it's formed, and deployment

### How the YAML is formed

Snowflake has **no native YAML** for agents:
- `GET_DDL('AGENT', …)` → *"Invalid object type: 'AGENT'"* (unsupported).
- `DESCRIBE AGENT` / `SHOW AGENTS` return **JSON** (`profile` + `agent_spec`).

So the app produces YAML itself. The **"Export as YAML"** button:
1. Builds the current form config: `{ name, comment?, profile?, models?, instructions?, tools?, tool_resources? }`.
2. Runs it through `js-yaml` (`yaml.dump`) → downloads `<name>.yaml` (or copies it).

Because JSON ⇄ YAML is 1:1, this is lossless. Example output:

```yaml
name: SALES_CONVERSATION_AGENT
models:
  orchestration: claude-sonnet-4-5
instructions:
  response: >-
    You are a Sales Intelligence Assistant…
  system: You are a helpful but constrained sales intelligence assistant…
tools:
  - tool_spec:
      type: cortex_search
      name: ConversationSearch
      description: Searches sales conversation transcripts
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: SalesAnalyst
      description: Generates and executes SQL queries on sales metrics
tool_resources:
  ConversationSearch:
    name: SALES_INTELLIGENCE.DATA.SALES_CONVERSATION_SEARCH
    max_results: "5"
  SalesAnalyst:
    semantic_model_file: "@SALES_INTELLIGENCE.DATA.MODELS/sales_metrics_model.yaml"
    execution_environment:
      type: warehouse
      warehouse: COMPUTE_WH
      query_timeout: 60
```

### How to deploy the YAML (and to multiple environments)

Snowflake has **no built-in "environments"** concept. You model environments with
separate **databases/schemas** (e.g. `_DEV`, `_PROD`) or separate **accounts**, and
promote with CI/CD.

To deploy the YAML:
1. Convert YAML → JSON (it's the create/update body from §3/§4).
2. `POST` it (new) or `PUT` it (existing) to the **target** environment's REST endpoint
   — i.e. a backend pointed at that environment's `SNOWFLAKE_HOST` / `DATABASE` /
   `SCHEMA`, or via the Snowflake CLI (`snow`) / Terraform provider / your own script.

> **The one real gotcha — parameterize per environment.** `tool_resources` reference
> **fully-qualified** objects that differ per env:
> `SALES_INTELLIGENCE.DATA.SALES_CONVERSATION_SEARCH`,
> `@SALES_INTELLIGENCE.DATA.MODELS/…yaml`, `COMPUTE_WH`. Template these
> (e.g. `${DATABASE}`, `${WAREHOUSE}`) and render per environment before deploying,
> and make sure the referenced semantic views / search services / warehouses actually
> exist in the target environment first.

> **Scope note:** this app is bound to a single environment (one `.env`). It *exports*
> the portable artifact but does not itself push to other environments — run a backend
> per env, or use external CI tooling.

---

## 7. Chat / session endpoint — conversation memory via threads

**Short answer:** the bare `:run` endpoint is **stateless**, but Snowflake also
provides **threads**, which persist conversation history **server-side**. This app
uses threads, so the agent **remembers earlier turns** without the client resending
the whole transcript.

**Endpoints involved:**
- `POST /api/agents/:name/messages` → Snowflake `POST …/agents/{name}:run` (SSE stream)
- `POST /api/threads` → Snowflake `POST /api/v2/cortex/threads` (create a thread)
- `GET /api/threads/:id` → Snowflake `GET /api/v2/cortex/threads/{id}` (read history)

### How threads work

Snowflake stores messages in a **tree** per thread. Each turn is identified by a
`message_id`; you tell the agent where to attach the new turn via
`parent_message_id`.

1. **Create a thread** (once per conversation):
   ```http
   POST /api/v2/cortex/threads
   { "origin_application": "dash-desai" }
   → 200 { "thread_id": 795105100, "created_on": …, … }
   ```
2. **Run with thread context** — send **only the new user message**, plus
   `thread_id` and `parent_message_id` (`0` for the first turn):
   ```json
   {
     "thread_id": 795105100,
     "parent_message_id": 0,
     "messages": [ { "role": "user", "content": [ { "type": "text", "text": "My favorite color is teal." } ] } ],
     "tool_choice": { "type": "auto" },
     "stream": true
   }
   ```
3. **Capture the assistant `message_id`** from the SSE `metadata` event:
   ```
   event: metadata
   data: {"metadata":{"message_id":203546898953,"role":"assistant"}}
   ```
4. **Next turn:** reuse the same `thread_id` and set
   `parent_message_id` = that **assistant** `message_id` (never a user id). Send only
   the new message — Snowflake supplies the prior context.

> **Verified:** with a thread, turn 1 "My favorite color is teal" → turn 2 "What is
> my favorite color?" answers **"Teal"**, even though only the new message is sent
> each time. Setting `parent_message_id` to an earlier assistant id **forks** the
> conversation into a new branch.

### What this app does (`src/hooks/useChatMessages.ts`)

- Lazily creates a thread on the first message (`createCortexThread()` → `/api/threads`).
- Sends `thread_id` + `parent_message_id` on every `:run`, but still only the single
  new user message.
- Parses the `metadata` SSE event and stores the latest **assistant** `message_id` in
  `parentMessageIdRef` for the next turn.
- Resets thread state on **New Chat** / **agent switch** (`clearMessages`), so each
  conversation gets a fresh thread.
- **Best-effort:** if thread creation fails, it falls back to a stateless single-turn
  call so chat never breaks (that turn simply has no memory).

> Without threads, the alternative is client-managed history: resend the full
> `messages` array (all prior user + assistant turns) on every call. Threads avoid
> that and keep the transcript in Snowflake.

### Response: SSE stream

The proxy streams Snowflake's `text/event-stream` straight through. Events the app
handles:

| SSE event | Meaning |
|---|---|
| `metadata` | Carries `{ message_id, role }` — track the **assistant** id for the next turn's `parent_message_id` |
| `response.status` | Progress/status text ("Planning…", "Running query…") |
| `response.thinking` / `response.thinking.delta` | Model reasoning (full / incremental) |
| `response.tool_result` | A tool ran (e.g. Analyst SQL result); app extracts SQL |
| `response.text.delta` | Incremental answer text (the streamed final answer) |
| `response.chart` | A `chart_spec` (Vega-Lite) to render |
| `response.text.annotation` | Citations / sources (e.g. from Cortex Search) |

`stream: true` yields SSE; `tool_choice: { "type": "auto" }` lets the agent pick which
tools to use. The proxy also handles client disconnects by cancelling the upstream
stream.

---

## 8. Quick reference — request/response cheatsheet

```text
# Create
POST /api/agents
  body:  { name, comment?, profile?, models?, instructions?, tools?, tool_resources?, _createMode? }
  → 200 { status }

# Edit: fetch then update
GET  /api/agents/:name          → { name, …, profile(JSON str), agent_spec(JSON str) }
PUT  /api/agents/:name
  body:  { comment?, profile?, models?, instructions?, tools?, tool_resources? }   # full spec
  → 200 { status }

# Conversation memory (threads)
POST /api/threads                     → { thread_id }
GET  /api/threads/:id                 → thread history

# Chat (SSE). With a thread, send only the new message + thread_id + parent_message_id.
POST /api/agents/:name/messages
  body:  { thread_id?, parent_message_id?,
           messages:[{role,content:[{type:"text",text}]}], tool_choice:{type:"auto"}, stream:true }
  → text/event-stream   # capture assistant message_id from the `metadata` event → next parent_message_id

# Objects
GET  /api/semantic-views?database=&schema=
POST /api/semantic-views              # CREATE SEMANTIC VIEW (structured body)
GET  /api/cortex-search-services?database=&schema=
POST /api/cortex-search-services      # CREATE CORTEX SEARCH SERVICE (needs warehouse)
GET  /api/metadata/{databases|schemas|tables|columns}
GET  /api/context                     # { database, schema, warehouse, warehouseConfigured }
```
