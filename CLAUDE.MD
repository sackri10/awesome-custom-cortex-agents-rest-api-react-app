# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React + TypeScript single-page app for talking to and managing **Snowflake Cortex Agents** via the Cortex Agents REST API. It ships with a small Express **backend proxy** whose sole job is to hold the Snowflake Programmatic Access Token (PAT) and forward requests, so credentials never reach the browser. UI is Material-UI (MUI v7) + Recharts.

## Commands

```bash
npm install                # install deps (Node >= 18, npm >= 9)

npm run start:all          # run BOTH frontend (:3000) and backend (:3001) together — the normal dev command
npm start                  # frontend only (craco start, :3000)
npm run start:server       # backend proxy only (node server/server.js, :3001)
npm run start:dev          # backend only with NODE_ENV=development

npm run build              # optimized production build → /build (no sourcemaps)
REACT_APP_BACKEND_URL=<url> npm run build   # build pointing the frontend at a non-local backend

npm test                   # craco test (react-scripts/jest, watch mode)
```

There is no lint script; ESLint runs through `react-scripts` (`eslintConfig` in `package.json`, `react-app` preset) during build/dev.

**Node version gotcha:** if the frontend fails with `SecurityError: Cannot initialize local storage without a '--localstorage-file' path`, downgrade to Node 20.

**Ports:** frontend 3000, backend 3001. If either is stuck: `lsof -ti:3000,3001 | xargs kill -9`.

## Environment setup

Two separate env files (both gitignored, both required for a working app):

- `.env` (copy from `env.backend.example`) — backend secrets: `SNOWFLAKE_HOST`, `SNOWFLAKE_PAT`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`, optional `SNOWFLAKE_WAREHOUSE`, plus `SERVER_PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`.
- `.env.local` (copy from `env.frontend.example`) — frontend only: `REACT_APP_BACKEND_URL` (the backend URL). **No Snowflake credentials ever go here.**

`SNOWFLAKE_WAREHOUSE` is optional: listing/metadata and chatting work without it, but **creating** Cortex Search services and semantic views requires it (those run DDL via the SQL API).

## Architecture

```
Browser (React, :3000)  ──HTTP──▶  Express proxy (server/, :3001)  ──HTTPS + PAT──▶  Snowflake REST + SQL APIs
```

**The frontend never calls Snowflake directly.** Every Snowflake call goes through the proxy, which attaches the PAT auth headers (`X-Snowflake-Authorization-Token-Type: PROGRAMMATIC_ACCESS_TOKEN` + `Authorization: Bearer <PAT>`). The proxy is bound to a **single** Snowflake environment (one `.env`).

### Backend (`server/`)
- `server.js` — the whole Express app: CORS (origin allowlist via `ALLOWED_ORIGINS`), rate limiting on `/api/`, request validation, all routes. Two upstream styles: **REST** endpoints (`/api/v2/databases/.../agents...`, `/api/v2/cortex/threads`) for agents/chat/threads, and the **SQL API** (`POST /api/v2/statements`) for object listing/creation via `SHOW`/`CREATE`.
- `snowflakeDdl.js` — builds `CREATE CORTEX SEARCH SERVICE` / `CREATE SEMANTIC VIEW` DDL from structured request bodies. Identifiers are validated (not string-injected); SQL expressions in semantic views are intentionally free text.
- `evalsClient.js` — SQL API client for agent evals + feedback (bind variables, 202 polling, partitions, typed values, 429/5xx retry) and the query catalogue over `SNOWFLAKE.LOCAL.GET_AI_EVALUATION_DATA` / `GET_AI_OBSERVABILITY_EVENTS` / `EXECUTE_AI_EVALUATION`. JS port of `snowflake_evals_feedback_client.py`; setup and privileges are in `cortex_agent_evals_and_feedback.md`.
- `evalRunRegistry.js` — JSON-file registry of eval runs (Snowflake has no "list runs" function). Default `server/.data/eval_runs.json`, override with `EVAL_RUNS_FILE`.
- `constants.js` — `HTTP_STATUS`, `ERROR_MESSAGES` (including the `TIPS.*` hints surfaced to the UI), `CONFIG` (ports, rate limits, name-length caps).

Errors are returned as `{ errorParts: [...] }` (an array of message lines) so the frontend can render structured, multi-line error messages with configuration hints.

### Frontend (`src/`)
- `App.tsx` — top-level view switcher (no router). Toggles between chat and the create/edit-agent page with local state; switching back to chat remounts it so a newly created agent appears.
- `components/Main.tsx` — the chat interface; `components/chat/*` are its subcomponents (header/agent selector, input with voice, message rendering, SQL/charts/annotations/thinking sections).
- `components/CreateAgentPage.tsx` + `components/objects/*` — the agent builder and the Cortex Search / semantic-view creation forms.
- `hooks/` — the real logic lives here: `useChatMessages` (SSE streaming + thread memory), `useAgentConfig` (loads agent list/config), `useSpeechRecognition` (Web Speech API voice input), `useAccordionState`.
- `components/EvalsPage.tsx` + `components/evals/*` — Evaluations & Feedback page (feedback stats/list, start/track eval runs, metric scores, per-question grid, traces). `components/chat/MessageFeedback.tsx` is the thumbs up/down on each answer.
- `services/snowflakeAgentsApi.ts`, `services/snowflakeObjectsApi.ts` and `services/snowflakeEvalsApi.ts` — typed wrappers around the backend proxy endpoints.
- `config/env.ts` validates env vars; `contexts/ThemeContext.tsx` + `theme/theme.ts` drive light/dark MUI theming.

### Key domain concepts (read `docs/AGENT_MANAGEMENT.md` before touching agent CRUD, chat, or YAML — it is the source of truth)
- **`agent_spec` is a JSON string.** `GET /api/agents/:name` returns `agent_spec` and `profile` as JSON *strings* you must `JSON.parse`. The spec holds `models`, `instructions`, `tools`, `tool_resources`.
- **Tool wiring:** every `tools[].tool_spec.name` must have a matching key in `tool_resources`. That mapping binds a tool to its data source (a semantic view/model file for `cortex_analyst_text_to_sql`, a search service for `cortex_search`).
- **Edit = full replacement.** `PUT /api/agents/:name` replaces the entire spec (no partial patch), so edit mode captures and re-emits unmodeled fields (`execution_environment`, `max_results`, `semantic_model_file`, id/title columns) unchanged to avoid silently dropping them. The agent **name is immutable** via update.
- **Create modes:** `POST /api/agents` takes a `_createMode` field (`errorIfExists` default, or `orReplace`) that the backend strips and turns into the `createMode` query param.
- **Chat uses threads for memory.** `useChatMessages` lazily creates a Snowflake thread (`POST /api/threads`), then on each `:run` sends only the *new* user message plus `thread_id` + `parent_message_id`; it tracks the latest **assistant** `message_id` from the SSE `metadata` event as the next `parent_message_id`. Thread state resets on New Chat / agent switch. Falls back to a stateless single-turn call if thread creation fails.
- **Streaming:** chat responses are SSE (`text/event-stream`) piped straight through the proxy. The client handles event types `metadata`, `response.status`, `response.thinking(.delta)`, `response.tool_result` (extracts SQL), `response.text.delta`, `response.chart` (Vega-Lite), `response.text.annotation` (citations).
- **Feedback & evals:** feedback goes to `agents/{name}:feedback` with `orig_request_id` = the `X-Snowflake-Request-ID` header of the `:run` call (the proxy forwards it and CORS exposes it; `useChatMessages` stores it on the assistant message). Reading feedback and everything eval-related goes through the SQL API and needs `SNOWFLAKE_WAREHOUSE`; optional `SNOWFLAKE_EVAL_ROLE` sets the role for that SQL. The feedback event's attribute names aren't documented, so `normalizeFeedback` matches on key suffixes.
- **YAML:** Snowflake has no native agent YAML. "Export as YAML" serializes the current form config with `js-yaml`; deploying it elsewhere means POST/PUT-ing the equivalent JSON to a backend pointed at the target environment (and parameterizing the fully-qualified `tool_resources` references per env).

## Deployment

`Dockerfile` + `supervisord.conf` + `nginx-combined.conf` run frontend and backend together in one container. `spcs/` contains SQL and a `spec.yaml.example` for deploying to Snowpark Container Services (see `spcs/README.md`).

## Git remotes

`origin` is the fork (`sackri10/...`); `upstream` is `Snowflake-Labs/awesome-custom-cortex-agents-rest-api-react-app`. Open PRs against `origin` unless told otherwise.
