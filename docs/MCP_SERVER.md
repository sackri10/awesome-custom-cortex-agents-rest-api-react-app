# Snowflake-managed MCP Server

A reference for the MCP (Model Context Protocol) integration in this app: how
Snowflake MCP servers relate to Cortex Agents, what tools you can expose, how
auth and privileges work, and how this repo discovers and invokes tools.

> **Official docs:**
> [Snowflake-managed MCP server](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp)
>
> **Quickstart:**
> [Getting Started with Managed Snowflake MCP Server](https://quickstarts.snowflake.com/guide/getting-started-with-snowflake-mcp-server/index.html)

---

## 1. Architecture in this app

The React frontend never talks to Snowflake MCP directly. Same pattern as Cortex
Agents REST: the Express proxy holds the PAT and forwards JSON-RPC calls.

```
Browser (React McpToolsPage)
    │  GET  /api/mcp/tools
    │  POST /api/mcp/tools/call
    ▼
Backend proxy (server/server.js + server/mcpClient.ts)
    │  POST https://<host>/api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}
    │  Auth: PAT + PROGRAMMATIC_ACCESS_TOKEN
    ▼
Snowflake-managed MCP SERVER object
    │  tools/list  → discover tools
    │  tools/call  → invoke a tool
    ▼
Underlying objects (Agent, Search, Analyst, SQL, UDF/SP)
```

| Piece | Path / role |
|---|---|
| MCP client | `server/mcpClient.ts` |
| Express routes | `server/server.js` → `/api/mcp/*` |
| Frontend API | `src/services/snowflakeMcpApi.ts` |
| UI demo | `src/components/McpToolsPage.tsx` (hub icon in chat toolbar) |
| Create SQL | `server/sql/create_mcp_server.sql` |
| Env key | `SNOWFLAKE_MCP_SERVER` in `.env` / `env.backend.example` |

---

## 2. Agent vs MCP server — not 1:1

**Cortex Agent** and **MCP SERVER** are different Snowflake objects.

| Concept | What it is |
|---|---|
| Cortex Agent | Orchestrator that can use Analyst, Search, custom tools, etc. internally |
| MCP SERVER | A standards-based **catalog of tools** that external MCP clients can discover and call |

Relationship:

- One MCP server can expose **many** tools (agents, search, analyst, SQL, UDFs…).
- One agent can appear as **one** tool (`CORTEX_AGENT_RUN`) on an MCP server.
- The same agent/search/UDF can be referenced from **multiple** MCP servers if you want.

```
MCP SERVER (1 object)
├── tool: cortex_agent        → CORTEX_AGENT_RUN       → one Agent
├── tool: revenue_analyst     → CORTEX_ANALYST_MESSAGE → one Semantic View
├── tool: docs_search         → CORTEX_SEARCH_SERVICE_QUERY → one Search service
├── tool: sql_exec            → SYSTEM_EXECUTE_SQL
└── tool: multiply_by_ten     → GENERIC                → one UDF / procedure
```

When a client calls an agent tool, the MCP server passes the question to the
agent; the **agent** then chooses and runs its own configured Analyst / Search /
custom tools. That is different from exposing Analyst/Search as separate MCP
tools for the *external* client to pick.

---

## 3. Supported tool types

Snowflake currently supports these MCP tool types:

| `type` | Exposes | Typical client arguments |
|---|---|---|
| `CORTEX_AGENT_RUN` | Cortex Agent | `message` (natural language) |
| `CORTEX_ANALYST_MESSAGE` | Semantic view (Analyst) | `message` — returns generated SQL (and related Analyst output) |
| `CORTEX_SEARCH_SERVICE_QUERY` | Cortex Search service | `query`, optional `columns`, `filter`, `limit` |
| `SYSTEM_EXECUTE_SQL` | Run SQL on Snowflake | `sql` |
| `GENERIC` | UDF or stored procedure | Matches the function/procedure signature (`input_schema`) |

### Limits (Snowflake)

- **Max 50 tools per MCP server** (all types combined). Need more → create another MCP server.
- MCP protocol support is **tools only**: no resources, prompts, roots, notifications, sampling, or full lifecycle negotiation.
- Responses are **non-streaming**.
- Generic / SQL tool responses may be **truncated** (~250 KB) to protect LLM context windows.
- Analyst via MCP uses **semantic views** (not semantic model YAML files).

### Recommended vs “expose everything”

Snowflake generally recommends, for **governed business Q&A**:

1. Configure Analyst / Search / custom tools **on the Cortex Agent**.
2. Expose **that agent** as the main (or only) client-facing MCP tool.
3. Let the agent orchestrate.

Exposing Analyst, Search, SQL, and UDFs **directly** on the MCP server is valid
when the external client (this app’s MCP Tools page, Cursor, Claude, etc.) should
choose tools itself — which is what the demo UI does.

**Caution:** Putting `SYSTEM_EXECUTE_SQL` on the **same** MCP server as an agent
lets the client bypass the agent’s semantic views, verified queries, and
orchestration. Prefer a separate MCP server + least-privileged role if you need
raw SQL.

---

## 4. Create / manage an MCP server in Snowflake

### Minimal (agent only)

See `server/sql/create_mcp_server.sql`. Align database/schema with
`SNOWFLAKE_DATABASE` / `SNOWFLAKE_SCHEMA`, and replace the agent name:

```sql
CREATE OR REPLACE MCP SERVER snowflake_intelligence.agents.cortex_mcp_server
  FROM SPECIFICATION $$
  tools:
    - title: "Cortex business data agent"
      name: "cortex_agent"
      type: "CORTEX_AGENT_RUN"
      identifier: "snowflake_intelligence.agents.<YOUR_AGENT_NAME>"
      description: "Ask governed business data questions via the Cortex Agent."
  $$;
```

### Richer server (agent + search + analyst + SQL + UDF)

Example shape (adjust identifiers to your account):

```sql
CREATE OR REPLACE MCP SERVER snowflake_intelligence.agents.cortex_mcp_server
  FROM SPECIFICATION $$
  tools:
    - title: "Cortex business data agent"
      name: "cortex_agent"
      type: "CORTEX_AGENT_RUN"
      identifier: "snowflake_intelligence.agents.<YOUR_AGENT_NAME>"
      description: "Governed Q&A via the Cortex Agent."

    - title: "Revenue semantic view"
      name: "revenue_analyst"
      type: "CORTEX_ANALYST_MESSAGE"
      identifier: "<db>.<schema>.<semantic_view>"
      description: "Generate SQL from natural language over the revenue semantic view."

    - title: "Support tickets search"
      name: "support_search"
      type: "CORTEX_SEARCH_SERVICE_QUERY"
      identifier: "<db>.<schema>.<search_service>"
      description: "Keyword and vector search over support tickets."

    - title: "SQL Execution Tool"
      name: "sql_exec_tool"
      type: "SYSTEM_EXECUTE_SQL"
      description: "Execute SQL against Snowflake."
      config:
        read_only: true
        query_timeout: 600
        warehouse: "<warehouse_name>"

    - title: "Multiply by ten"
      name: "multiply_by_ten"
      type: "GENERIC"
      identifier: "<db>.<schema>.MULTIPLY_BY_TEN"
      description: "Custom UDF example."
      config:
        type: "function"          # or "procedure"
        warehouse: "<warehouse_name>"
        query_timeout: 120
        input_schema:
          type: "object"
          properties:
            x:
              type: "number"
              description: "Number to multiply by ten"
  $$;
```

### Inspect / drop

```sql
SHOW MCP SERVERS IN SCHEMA snowflake_intelligence.agents;
DESCRIBE MCP SERVER snowflake_intelligence.agents.cortex_mcp_server;
DROP MCP SERVER snowflake_intelligence.agents.cortex_mcp_server;
```

Use precise **name** and **description** fields — MCP clients (and LLMs) pick
tools from those strings.

---

## 5. Privileges

Access to the MCP server **does not** grant access to underlying tools. Grant
both.

| Privilege | Object | Purpose |
|---|---|---|
| `USAGE` | MCP SERVER | Connect, `tools/list`, `tools/call` (discover/invoke) |
| `MODIFY` / `OWNERSHIP` | MCP SERVER | Update / drop / describe configuration |
| `USAGE` | Cortex Agent | Invoke `CORTEX_AGENT_RUN` |
| `USAGE` | Cortex Search Service | Invoke search tool |
| `SELECT` | Semantic View | Invoke Analyst tool |
| `USAGE` | UDF / stored procedure | Invoke `GENERIC` tool |
| `USAGE` | Warehouse / Database / Schema | Session prerequisites |
| Database role | `SNOWFLAKE.CORTEX_AGENT_USER` | Typically needed for agent use |

Example role grants (from the SQL file comments):

```sql
GRANT USAGE ON MCP SERVER snowflake_intelligence.agents.cortex_mcp_server TO ROLE <MCP_ROLE>;
GRANT USAGE ON AGENT snowflake_intelligence.agents.<YOUR_AGENT_NAME> TO ROLE <MCP_ROLE>;
-- plus grants for each Search / Semantic View / UDF / procedure you expose
```

The PAT used by this app must be issued for a role that has these privileges
(least privilege recommended).

---

## 6. MCP server URL and authentication

### Endpoint format

```
https://<SNOWFLAKE_HOST>/api/v2/databases/{database}/schemas/{schema}/mcp-servers/{name}
```

Built in this app from:

| Env var | Example |
|---|---|
| `SNOWFLAKE_HOST` | `org-account.snowflakecomputing.com` |
| `SNOWFLAKE_DATABASE` | `snowflake_intelligence` |
| `SNOWFLAKE_SCHEMA` | `agents` |
| `SNOWFLAKE_MCP_SERVER` | `cortex_mcp_server` |
| `SNOWFLAKE_PAT` | (server-only secret) |

If hostnames contain underscores, some MCP clients need **hyphens** instead —
Snowflake documents connection issues with underscores in hostnames.

### Auth used by this app

Same as the existing Agents proxy:

```http
X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN
Authorization: Bearer <SNOWFLAKE_PAT>
Content-Type: application/json
Accept: application/json
```

Snowflake also supports **OAuth** for interactive clients (Claude, ChatGPT,
Cursor Sign-in). This repo uses **PAT** for the custom programmatic client,
matching the Quickstart `curl` / Cursor header examples.

---

## 7. Protocol: discovery and invocation

Snowflake MCP speaks **JSON-RPC 2.0** over HTTP `POST` to the MCP server URL.
Only **`tools/list`** and **`tools/call`** are used here.

### `tools/list`

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

Response (shape):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "cortex_agent",
        "title": "Cortex business data agent",
        "description": "...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "message": { "type": "string", "description": "The user's question." }
          },
          "required": ["message"]
        }
      }
    ]
  }
}
```

### `tools/call`

**Agent / Analyst-style:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "cortex_agent",
    "arguments": {
      "message": "What were total sales last quarter?"
    }
  }
}
```

**Search-style:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "support_search",
    "arguments": {
      "query": "billing refund delay",
      "limit": 10
    }
  }
}
```

**SQL-style:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "sql_exec_tool",
    "arguments": {
      "sql": "SELECT CURRENT_TIMESTAMP()"
    }
  }
}
```

**GENERIC UDF-style:**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "multiply_by_ten",
    "arguments": { "x": 4.2 }
  }
}
```

Always pass the tool **`name`** from `tools/list` (not the Snowflake object FQN).
Argument shapes come from each tool’s **`inputSchema`** — the React demo builds
form fields from that schema dynamically.

### Curl smoke test

```bash
curl -X POST \
  "https://<SNOWFLAKE_HOST>/api/v2/databases/snowflake_intelligence/schemas/agents/mcp-servers/cortex_mcp_server" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header "Authorization: Bearer <SNOWFLAKE_PAT>" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## 8. How this app invokes MCP

### Backend (`server/mcpClient.ts`)

1. Builds the MCP URL from host / database / schema / `SNOWFLAKE_MCP_SERVER`.
2. Sends JSON-RPC `POST` with PAT headers.
3. Surfaces HTTP and JSON-RPC errors as `SnowflakeMcpError`.

Public methods:

- `listTools()` → `tools/list`
- `callTool(name, arguments)` → `tools/call`
- `getEndpoint()` → fully qualified URL (for `/api/mcp/context`)

### Proxy routes (`server/server.js`)

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/mcp/context` | Non-sensitive config: db, schema, mcp server name, endpoint, `configured` flag |
| `GET` | `/api/mcp/tools` | Proxy `tools/list` → `{ tools: [...] }` |
| `POST` | `/api/mcp/tools/call` | Body `{ name, arguments }` → proxy `tools/call` → `{ result: ... }` |

If `SNOWFLAKE_MCP_SERVER` is unset, `/api/mcp/tools` and `/api/mcp/tools/call`
return **503** with a tip pointing at `server/sql/create_mcp_server.sql`.
Chat / Agents REST continues to work without MCP configured.

### Frontend

1. Chat toolbar **hub** icon → `McpToolsPage`.
2. Page loads context + `listMcpTools()`.
3. User selects a tool; inputs are rendered from `inputSchema.properties`.
4. **Call tool** → `callMcpTool(name, args)` → shows text/`content` or JSON result.

### Env setup checklist

1. Run `server/sql/create_mcp_server.sql` (with your agent / tools).
2. Grant privileges to the PAT’s role.
3. Add to backend `.env`:

   ```
   SNOWFLAKE_MCP_SERVER=cortex_mcp_server
   ```

4. Restart: `npm run start:all` (server uses `tsx` so it can load `mcpClient.ts`).
5. Open the hub icon → list tools → call with params.

---

## 9. Design choices for this integration

| Choice | Why |
|---|---|
| Custom TypeScript client instead of only Cursor `mcp.json` | Same stack as the Express proxy; usable from React via `/api/mcp/*` |
| PAT auth | Matches existing `server.js` Agents proxy; no OAuth UI required for demo |
| Dynamic args from `inputSchema` | Works for whatever `tools/list` returns — agent, search, analyst, SQL, UDF |
| Optional `SNOWFLAKE_MCP_SERVER` | MCP is additive; missing config does not break chat |
| Expose tools directly on MCP for the demo | Client-driven tool selection (option “B”); agent-only is still the governed default in Snowflake docs |

---

## 10. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| `/api/mcp/*` returns 503 “not configured” | Missing env | Set `SNOWFLAKE_MCP_SERVER`, restart server |
| HTTP 401 / 403 | Bad or under-privileged PAT | Token validity; role has `USAGE` on MCP + each tool |
| HTTP 404 | Wrong name/path | `SHOW MCP SERVERS`; db/schema/server name match `.env` |
| Tools list empty | Spec has no tools, or role can’t see them | `DESCRIBE MCP SERVER`; grants |
| Tool visible but call fails | Missing object privilege | Grant on Agent / Search / Semantic View / UDF |
| Hostname connection issues | Underscores in account URL | Try hyphens in host per Snowflake guidance |
| Agent responses huge | Intermediate traces + search hits | Lower agent search `max_results`; expect large payloads by design |

---

## 11. Related files

```
server/mcpClient.ts                 # MCP JSON-RPC client
server/server.js                    # /api/mcp/* routes
server/sql/create_mcp_server.sql    # CREATE MCP SERVER template
server/tsconfig.json                # TS check for server client
src/services/snowflakeMcpApi.ts     # Frontend → proxy
src/components/McpToolsPage.tsx     # Tools demo UI
env.backend.example                 # Documents SNOWFLAKE_MCP_SERVER
docs/AGENT_MANAGEMENT.md            # Parallel docs for Agents REST (non-MCP)
```

External:

- [Snowflake-managed MCP server](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client)
