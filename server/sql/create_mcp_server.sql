-- ============================================================================
-- Create a Snowflake-managed MCP SERVER for this app
-- Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp
-- ============================================================================
-- 1. Replace <YOUR_AGENT_NAME> with an existing Cortex Agent in this schema
--    (or add more tools: CORTEX_ANALYST_MESSAGE, CORTEX_SEARCH_SERVICE_QUERY, etc.)
-- 2. Align DATABASE / SCHEMA with SNOWFLAKE_DATABASE / SNOWFLAKE_SCHEMA in .env
-- 3. Set SNOWFLAKE_MCP_SERVER=cortex_mcp_server in your backend .env
-- ============================================================================

-- Optional: inspect agents you can expose
-- SHOW AGENTS IN SCHEMA snowflake_intelligence.agents;

CREATE OR REPLACE MCP SERVER sales_intelligence.data.cortex_mcp_server
  FROM SPECIFICATION $$
  tools:
    - title: "Sales conversation agent"
      name: "sales_conversation_agent"
      type: "CORTEX_AGENT_RUN"
      identifier: "sales_intelligence.data.SALES_CONVERSATION_AGENT"
      description: "Ask governed sales questions via the Sales Conversation Agent."

    - title: "Sales metrics semantic view"
      name: "sales_metrics"
      type: "CORTEX_ANALYST_MESSAGE"
      identifier: "sales_intelligence.data.sales_metrics"
      description: "Generate SQL and answer questions over sales deals, customers, stages, reps, product lines, and deal value."
  $$;

SALES_INTELLIGENCE.DATA.SALES_CONVERSATIONSDESCRIBE MCP SERVER sales_intelligence.data.cortex_mcp_server;
SHOW MCP SERVERS IN SCHEMA sales_intelligence.data;

-- ----------------------------------------------------------------------------
-- Privileges for the role used by your PAT (replace <MCP_ROLE> and warehouse)
-- Access to the MCP SERVER does NOT grant access to underlying tools —
-- grant USAGE / SELECT on each tool object as well.
-- ----------------------------------------------------------------------------

-- CREATE ROLE IF NOT EXISTS <MCP_ROLE>;
-- GRANT DATABASE ROLE SNOWFLAKE.CORTEX_AGENT_USER TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON WAREHOUSE <YOUR_WAREHOUSE> TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON DATABASE snowflake_intelligence TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON SCHEMA snowflake_intelligence.agents TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON MCP SERVER snowflake_intelligence.agents.cortex_mcp_server TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON AGENT snowflake_intelligence.agents.<YOUR_AGENT_NAME> TO ROLE <MCP_ROLE>;
-- GRANT ROLE <MCP_ROLE> TO USER <YOUR_USERNAME>;

-- Smoke test (from a machine with network access to Snowflake):
-- curl -X POST "https://<SNOWFLAKE_HOST>/api/v2/databases/snowflake_intelligence/schemas/agents/mcp-servers/cortex_mcp_server" \
--   --header 'Content-Type: application/json' \
--   --header 'Accept: application/json' \
--   --header "Authorization: Bearer <SNOWFLAKE_PAT>" \
--   --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
