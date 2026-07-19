/**
 * Backend Server Constants
 * Centralized constants for HTTP status codes, error messages, and configuration
 */

// HTTP Status Codes
const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503
};

// Error Message Constants
const ERROR_MESSAGES = {
  ERROR_PREFIX: 'PAWS right there! We have hit a snag :(',
  HTTP_ERROR_STATUS: 'HTTP Code:',
  
  // Tips for specific errors
  TIPS: {
    BAD_REQUEST: '💡 Tip: Check your SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA in the backend .env file. Make sure they exist and you have access to them.',
    UNAUTHORIZED: '💡 Tip: Check your SNOWFLAKE_PAT (Personal Access Token) in the backend .env file. Make sure it\'s valid and not expired.',
    NOT_FOUND: '💡 Tip: Check your SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA in the backend .env file. Make sure they exist and you have access to them.',
    NOT_FOUND_AGENT: (agentName) => `💡 Tip: The agent "${agentName}" may not exist, or check your SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA in the backend .env file.`,
    AGENT_EXISTS: (agentName) => `💡 Tip: An agent named "${agentName}" already exists in this schema. Choose a different name, or enable "Overwrite if it already exists" to replace it.`,
    SERVICE_UNAVAILABLE: '💡 Tip: Check your SNOWFLAKE_HOST in the backend .env file. Make sure it\'s correct and accessible (format: account.snowflakecomputing.com)',
    INVALID_AGENT_NAME: 'Invalid agent name format',
    MESSAGES_REQUIRED: 'Messages array is required',
    WAREHOUSE_REQUIRED: '💡 Tip: Set SNOWFLAKE_WAREHOUSE in the backend .env file. A warehouse is required to create Cortex Search services and semantic views.'
  }
};

// Configuration
const CONFIG = {
  MAX_AGENT_NAME_LENGTH: 100,
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,
  DEFAULT_PORT: 3001
};

module.exports = {
  HTTP_STATUS,
  ERROR_MESSAGES,
  CONFIG
};

