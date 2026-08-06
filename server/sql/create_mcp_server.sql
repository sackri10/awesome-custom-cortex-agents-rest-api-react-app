-- ============================================================================
-- Snowflake-managed MCP SERVER for this app
-- Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp
-- ============================================================================
-- Env alignment:
--   SNOWFLAKE_DATABASE=sales_intelligence
--   SNOWFLAKE_SCHEMA=data
--   SNOWFLAKE_WAREHOUSE=COMPUTE_WH
--   SNOWFLAKE_MCP_SERVER=cortex_mcp_server
--
-- Tools exposed:
--   1) CORTEX_AGENT_RUN          → SALES_CONVERSATION_AGENT
--   2) CORTEX_ANALYST_MESSAGE    → sales_metrics semantic view
--   3) SYSTEM_EXECUTE_SQL        → ad-hoc SQL (read-only)
--   4) GENERIC (procedure)       → get_customer_conversations(customer_name_param)
-- ============================================================================

USE DATABASE sales_intelligence;
USE SCHEMA data;

-- ----------------------------------------------------------------------------
-- Stored procedure used by the GENERIC MCP tool
--
-- IMPORTANT: Snowflake MCP GENERIC tools expect a *single-cell* return value
-- (scalar / VARIANT / VARCHAR). RETURNS TABLE(... ) with multiple columns
-- fails with: "expected a single cell result set, got N rows and M columns".
-- Pack rows into one VARIANT (JSON array) instead.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sales_intelligence.data.get_customer_conversations(customer_name_param STRING)
RETURNS VARIANT
LANGUAGE SQL
AS
$$
DECLARE
  result VARIANT;
BEGIN
  SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT(
      'CUSTOMER_NAME', CUSTOMER_NAME,
      'DEAL_STAGE', DEAL_STAGE,
      'CONVERSATION_DATE', CONVERSATION_DATE,
      'TRANSCRIPT_TEXT', TRANSCRIPT_TEXT,
      'SALES_REP', SALES_REP,
      'PRODUCT_LINE', PRODUCT_LINE
    )), [])
    INTO result
  FROM sales_intelligence.data.SALES_CONVERSATIONS
  WHERE CUSTOMER_NAME = :customer_name_param;

  RETURN result;
END;
$$;

-- Test:
-- ALTER WAREHOUSE COMPUTE_WH RESUME;
-- CALL sales_intelligence.data.get_customer_conversations('TechCorp Inc');

-- ----------------------------------------------------------------------------
-- MCP SERVER (agent + analyst + SQL + stored procedure)
-- ----------------------------------------------------------------------------
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

    - title: "SQL Execution Tool"
      name: "sql_exec_tool"
      type: "SYSTEM_EXECUTE_SQL"
      description: "Execute a SQL statement against Snowflake (read-only SELECT by default)."
      config:
        read_only: true
        query_timeout: 600
        warehouse: "COMPUTE_WH"

    - title: "Get customer conversations"
      name: "get_customer_conversations"
      type: "GENERIC"
      identifier: "sales_intelligence.data.get_customer_conversations"
      description: "Return sales conversation rows for a given customer name as a JSON array (single-cell VARIANT). Each element has CUSTOMER_NAME, DEAL_STAGE, CONVERSATION_DATE, TRANSCRIPT_TEXT, SALES_REP, PRODUCT_LINE."
      config:
        type: "procedure"
        warehouse: "COMPUTE_WH"
        query_timeout: 120
        input_schema:
          type: "object"
          properties:
            customer_name_param:
              description: "Exact customer name to filter on (e.g. TechCorp Inc)."
              type: "string"
          required:
            - customer_name_param
  $$;

DESCRIBE MCP SERVER sales_intelligence.data.cortex_mcp_server;
SHOW MCP SERVERS IN SCHEMA sales_intelligence.data;

-- ----------------------------------------------------------------------------
-- Privileges for the role used by your PAT (replace <MCP_ROLE>)
-- ----------------------------------------------------------------------------
-- GRANT USAGE ON DATABASE sales_intelligence TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON SCHEMA sales_intelligence.data TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON WAREHOUSE COMPUTE_WH TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON MCP SERVER sales_intelligence.data.cortex_mcp_server TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON AGENT sales_intelligence.data.SALES_CONVERSATION_AGENT TO ROLE <MCP_ROLE>;
-- GRANT SELECT ON SEMANTIC VIEW sales_intelligence.data.sales_metrics TO ROLE <MCP_ROLE>;
-- GRANT SELECT ON TABLE sales_intelligence.data.SALES_METRICS TO ROLE <MCP_ROLE>;
-- GRANT SELECT ON TABLE sales_intelligence.data.SALES_CONVERSATIONS TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON CORTEX SEARCH SERVICE sales_intelligence.data.SALES_CONVERSATION_SEARCH TO ROLE <MCP_ROLE>;
-- GRANT USAGE ON PROCEDURE sales_intelligence.data.get_customer_conversations(STRING) TO ROLE <MCP_ROLE>;

-- Smoke test tools/list:
-- curl -X POST "https://<SNOWFLAKE_HOST>/api/v2/databases/sales_intelligence/schemas/data/mcp-servers/cortex_mcp_server" \
--   --header 'Content-Type: application/json' \
--   --header 'Accept: application/json' \
--   --header "Authorization: Bearer <SNOWFLAKE_PAT>" \
--   --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
