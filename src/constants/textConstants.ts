/**
 * Centralized Text Constants
 * 
 * This file contains all static text, labels, and messages used throughout the application.
 * Edit these values to customize the application's text content.
 * 
*/

export const TEXT_CONSTANTS = {
  // Header and Navigation
  HEADER: {
    MAIN_TITLE: 'Dash DesAI',
    SUBTITLE_PREFIX: 'Powered by',
    SUBTITLE_MIDDLE: 'Snowflake Cortex Agents',
    SUBTITLE_SUFFIX: 'Developed by',
    SUBTITLE_DEVELOPER: 'Dash',
    SUBTITLE_LINK: 'https://www.linkedin.com/in/dash-desai/',
    CORTEX_AGENTS_LINK: 'https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents',
    DESCRIPTION: '',
    SHARE_BUTTON: 'Share',
    LOGO_PATH: '/images/icons/dash_snowboard_512.png',
    LOGO_ALT: 'Dash DesAI - Powered by Snowflake Cortex Agents',
    BACK_BUTTON: '← Back',
    AGENT_SELECTOR: {
      LABEL: 'Select Agent',
      PLACEHOLDER: 'Choose an agent...'
    }
  },

  // Chat Interface
  CHAT: {
  EMPTY_STATE: {
    SUBHEADER: 'Let\'s paint a picture with your data!'
  },

  // Time-based greetings
  GREETINGS: {
    MORNING: [
      'Good Morning, Champion!',
      'Morning, Data Explorer!',
      'Good Morning, Data Wizard!',
      'Good Morning, Analyst!'
    ],
    AFTERNOON: [
      'Good Afternoon, Champion!',
      'Afternoon Insights Await!',
      'Good Afternoon, Data Star!',
      'Good Afternoon, Explorer!'
    ],
    EVENING: [
      'Good Evening, Data Star!',
      'Evening Magic Time!',
      'Good Evening, Champion!',
      'Good Evening, Super Analyst!'
    ],
    NIGHT: [
      'Burning the Midnight Oil?',
      'Night Owl Mode Activated!',
      'Late Night Insights Await!',
      'Working Late? Respect!',
      'Night Shift Activated!'
    ]
  },

  STARTER_QUESTIONS: {
    TITLE: 'Suggested questions for Data Agent: ',
    SUBTITLE: 'See available agents below and select one. Then, select a suggested question or ask one to get started.'
  },
    
    INPUT: {
      PLACEHOLDER: 'Ask Dash DesAI...',
      PLACEHOLDER_LOADING: 'Processing request. Please wait...',
      SEND_BUTTON: 'Send',
      SEND_BUTTON_LOADING: '⏳',
      FOOTER_TEXT: 'Press ⌘+Enter to send • Enter for new line',
      NEW_CHAT_BUTTON: 'New Chat',
      NEW_CHAT_TOOLTIP: 'Start a new conversation',
      SEND_TOOLTIP: 'Send message (⌘+Enter)',
      STOP_TOOLTIP: 'Cancel current request'
    },

    THINKING_STEPS: {
      TITLE: 'Thinking & Planning',
      LABEL: 'thinking step',
      LABEL_PLURAL: 'thinking steps',
      PROCESSING_SUFFIX: ' (processing...)',
      PROCESSING_REALTIME: '',
      EXPAND_COLLAPSE_HINT: 'Click to expand/collapse thinking process'
    },

    VISUALIZATION: {
      TITLE: 'Visualization'
    },

    SQL_QUERIES: {
      HEADER: 'SQL Queries Executed',
      QUERY_LABEL: 'Query',
      EXECUTION_COUNT_SINGULAR: 'query executed',
      EXECUTION_COUNT_PLURAL: 'queries executed'
    },
    
    VERIFICATION: {
      VERIFIED_QUERY: 'Answer accuracy verified by agent owner',
      QUERY_VERIFIED: '✅ Query verified',
      RESPONSE_VALIDATED: '✅ Response validated',
      VERIFICATION_AVAILABLE: 'ℹ️ Verification information available',
      COUNT_LABEL_SINGULAR: 'verified query executed',
      COUNT_LABEL_PLURAL: 'verified queries executed'
    }
  },

  // Create Agent Page
  CREATE_AGENT: {
    NAV_BUTTON_TOOLTIP: 'Create a new Cortex agent',
    BACK_TO_CHAT: '← Back to chat',
    PAGE_TITLE: 'Create a new Cortex Agent',
    PAGE_SUBTITLE: 'Fill in the details below to create a new Snowflake Cortex Agent. Only the agent name is required — everything else is optional.',
    PAGE_TITLE_EDIT: 'Edit Cortex Agent',
    PAGE_SUBTITLE_EDIT: 'Update this agent\'s configuration. The agent name cannot be changed.',
    NAME_LOCKED_HELP: 'The agent name is the object identifier and cannot be changed.',
    LOADING_AGENT: 'Loading agent configuration...',
    SUBMIT_EDIT: 'Save changes',
    SUBMITTING_EDIT: 'Saving changes...',
    SUCCESS_TITLE_EDIT: 'Agent updated!',
    SUCCESS_MESSAGE_EDIT: 'Your changes have been saved. Returning to chat...',
    EDIT_TOOLTIP: 'Edit the selected agent',
    SECTION_BASICS: 'Basics',
    SECTION_TOOLS: 'Tools',
    SECTION_INSTRUCTIONS: 'Instructions',
    SECTION_QUESTIONS: 'Sample questions',
    SECTION_ADVANCED: 'Advanced (raw tools & resources JSON)',
    ADVANCED_HELP: 'Optional. Anything you add here is merged on top of the tools selected above — extra tool_spec entries are appended and tool_resources are merged by name. Most users can leave this empty.',
    TOOLS_SEMANTIC_LABEL: 'Query structured data (semantic views)',
    TOOLS_SEMANTIC_PLACEHOLDER: 'Select semantic views',
    TOOLS_SEMANTIC_HELP: 'Attaches a Cortex Analyst tool for each selected semantic view.',
    TOOLS_SEARCH_LABEL: 'Search documents & unstructured data (Cortex Search)',
    TOOLS_SEARCH_PLACEHOLDER: 'Select search services',
    TOOLS_SEARCH_HELP: 'Attaches a Cortex Search tool for each selected search service.',
    TOOLS_CREATE_SEMANTIC: 'Create semantic view',
    TOOLS_CREATE_SEARCH: 'Create search service',
    TOOLS_LOAD_ERROR: 'Could not load existing semantic views / search services. You can still add tools via the Advanced JSON section below.',
    TOOLS_SCOPE_HELP: 'Pick the database and schema to browse. Semantic views and search services can live in any schema — not just the agents schema.',
    TOOLS_DATABASE_LABEL: 'Database',
    TOOLS_SCHEMA_LABEL: 'Schema',
    TOOLS_MODELFILE_HELP: 'This Cortex Analyst tool is backed by a semantic model file (a YAML on a stage), which can\'t be edited here. Rebind it to a native semantic view — the tool name and warehouse settings are preserved. (To edit the YAML itself, use Snowsight.)',
    TOOLS_REBIND_LABEL: 'Rebind to a semantic view',
    NAME_LABEL: 'Agent name (identifier)',
    NAME_HELP: 'Unique name in this schema. Letters, numbers and underscores only (must start with a letter or underscore).',
    DISPLAY_NAME_LABEL: 'Display name',

    DISPLAY_NAME_HELP: 'Friendly name shown in the UI. Defaults to the agent name if left blank.',
    COMMENT_LABEL: 'Description / comment',
    MODEL_LABEL: 'Orchestration model',
    MODEL_HELP: 'Model used to orchestrate the agent. "auto" lets Snowflake pick. Available models vary by region.',
    RESPONSE_INSTRUCTION_LABEL: 'Response instructions',
    RESPONSE_INSTRUCTION_HELP: 'Guidance on how the agent should phrase and format its answers.',
    ORCHESTRATION_INSTRUCTION_LABEL: 'Orchestration instructions',
    ORCHESTRATION_INSTRUCTION_HELP: 'Guidance on how the agent should plan and use its tools.',
    SYSTEM_INSTRUCTION_LABEL: 'System instructions',
    SYSTEM_INSTRUCTION_HELP: 'High-level persona and rules for the agent.',
    QUESTION_LABEL: 'Sample question',
    ADD_QUESTION: 'Add question',
    TOOLS_LABEL: 'Tools (JSON array)',
    TOOLS_HELP: 'Optional. A JSON array of tool_spec objects. Leave blank if the agent has no tools.',
    TOOL_RESOURCES_LABEL: 'Tool resources (JSON object)',
    TOOL_RESOURCES_HELP: 'Optional. A JSON object mapping tool names to their resources (e.g. semantic views, search services).',
    OVERWRITE_LABEL: 'Overwrite if an agent with this name already exists',
    EXPORT_YAML: 'Export as YAML',
    COPY_YAML: 'Copy YAML',
    YAML_COPIED: 'Agent config (YAML) copied to clipboard',
    YAML_COPY_FAILED: 'Could not copy to clipboard',
    SUBMIT: 'Create agent',
    SUBMITTING: 'Creating agent...',
    SUCCESS_TITLE: 'Agent created!',
    SUCCESS_MESSAGE: 'Your new agent is ready. Returning to chat...',
    INVALID_NAME: 'Agent name must start with a letter or underscore and contain only letters, numbers and underscores.',
    INVALID_TOOLS_JSON: 'Tools must be valid JSON (a JSON array).',
    INVALID_TOOL_RESOURCES_JSON: 'Tool resources must be valid JSON (a JSON object).'
  },

  // MCP Tools demo page
  MCP_TOOLS: {
    NAV_BUTTON_TOOLTIP: 'Browse and call Snowflake MCP tools',
    BACK_TO_CHAT: '← Back to chat',
    PAGE_TITLE: 'Snowflake MCP Tools',
    PAGE_SUBTITLE: 'Discover tools from your Snowflake-managed MCP server and invoke them with arguments from each tool\'s input schema.',
    REFRESH: 'Refresh tools',
    TOOL_LABEL: 'Tool',
    ARGS_TITLE: 'Arguments',
    NO_ARGS: 'This tool has no input parameters.',
    CALL: 'Call tool',
    CALLING: 'Calling…',
    RESULT_TITLE: 'Result',
    EMPTY_RESULT: '(empty result)',
    NOT_CONFIGURED_TITLE: 'MCP not configured',
    NOT_CONFIGURED:
      'Create an MCP SERVER in Snowflake (see server/sql/create_mcp_server.sql), set SNOWFLAKE_MCP_SERVER in your backend .env, and restart the server.',
    NO_TOOLS: 'The MCP server returned no tools. Check the MCP SERVER specification in Snowflake.',
    LOAD_ERROR_TITLE: 'Could not load tools',
    LOAD_ERROR: 'Failed to list MCP tools.',
    CALL_ERROR_TITLE: 'Tool call failed',
    CALL_ERROR: 'Failed to call MCP tool.',
  },

  // Feedback on chat answers + Evals & Feedback page
  EVALS: {
    NAV_BUTTON_TOOLTIP: 'Evaluations & feedback',
    BACK_TO_CHAT: '← Back to chat',
    PAGE_TITLE: 'Evaluations & Feedback',
    PAGE_SUBTITLE: 'Run Cortex Agent evaluations against your ground-truth dataset and review what users said about real answers.',
    AGENT_LABEL: 'Agent',
    TAB_FEEDBACK: 'User feedback',
    TAB_EVALS: 'Evaluation runs',

    // Feedback on a chat answer
    HELPFUL_TOOLTIP: 'Good answer',
    NOT_HELPFUL_TOOLTIP: 'Bad answer',
    DIALOG_TITLE_POSITIVE: 'What was good about this answer?',
    DIALOG_TITLE_NEGATIVE: 'What went wrong?',
    // Negative categories map to eval metrics: wrong tool → tool_selection_accuracy,
    // wrong number → answer_correctness / semantic view, made something up → no_fabrication.
    POSITIVE_CATEGORIES: ['Correct answer', 'Clear explanation', 'Useful chart', 'Fast'],
    NEGATIVE_CATEGORIES: ['Wrong number', 'Wrong tool', 'Made something up', 'Misunderstood question', 'Incomplete answer', 'Too slow'],
    COMMENT_LABEL: 'Comment (optional)',
    COMMENT_PLACEHOLDER: 'e.g. Revenue looks like it includes cancelled orders',
    SUBMIT: 'Send feedback',
    SUBMITTING: 'Sending…',
    CANCEL: 'Cancel',
    SUBMITTED: 'Thanks, feedback sent to Snowflake.',
    SUBMIT_ERROR: 'Could not send feedback.',
    NO_REQUEST_ID: 'No request id was returned for this answer, so the feedback will be recorded against the agent overall.',

    // Feedback tab
    SINCE_LABEL: 'Since (UTC)',
    LOAD_FEEDBACK: 'Load feedback',
    FEEDBACK_NOTE: 'Feedback reaches the observability events table a few minutes after it is sent. Comments show as redacted unless the role has READ UNREDACTED AI OBSERVABILITY EVENTS TABLE.',
    FEEDBACK_EMPTY: 'No feedback in this window.',
    FEEDBACK_TOTAL: 'Responses rated',
    FEEDBACK_POSITIVE_RATE: 'Positive',
    FEEDBACK_NEGATIVE: 'Negative',
    FEEDBACK_CATEGORIES: 'Categories',
    FEEDBACK_LIST: 'Recent feedback',
    AGENT_LEVEL: 'agent-level',

    // Evals tab
    NEW_RUN_TITLE: 'Start or track a run',
    RUN_NAME_LABEL: 'Run name',
    RUN_NAME_HELPER: 'Must be unique per run. Letters, numbers, "_" and "-".',
    CONFIG_PATH_LABEL: 'Config YAML on a stage',
    CONFIG_PATH_REQUIRED: 'Enter the stage path of the config file to enable the buttons.',
    CONFIG_PATH_INVALID: 'Must start with @ and end in .yaml or .yml, e.g. @SALES_EVAL_DB.DATA.EVAL_CONFIGS/agent_eval_config_rerun.yaml',
    RUN_NAME_INVALID: 'Use 1-128 letters, numbers, "_" or "-" (no spaces).',
    CONFIG_PATH_HELPER: 'Fully qualified, e.g. @MY_DB.MY_SCHEMA.EVAL_CONFIGS/agent_eval_config_rerun.yaml',
    RUN_LABEL_LABEL: 'Label (optional)',
    START_RUN: 'Start run',
    TRACK_RUN: 'Track existing run',
    STARTING: 'Starting…',
    RUNS_TITLE: 'Tracked runs',
    RUNS_EMPTY: 'No runs tracked for this agent yet. Start one above, or track a run you started in a worksheet or CI.',
    REFRESH_STATUS: 'Check status',
    VIEW_RESULTS: 'Results',
    UNTRACK: 'Stop tracking',
    METRICS_TITLE: 'Average score by metric',
    RECORDS_TITLE: 'Per-question scores',
    SHOW_WEAK_ONLY: 'Only scores below 0.7',
    TRACE: 'Trace',
    TRACE_TITLE: 'Record trace',
    LOGS: 'Errors & warnings',
    LOGS_EMPTY: 'No errors or warnings logged for this run.',
    RESULTS_EMPTY: 'No results yet. Runs take a few minutes; check status until it reports COMPLETED.',
    RERUN_HINT: 'Scores move between runs even when nothing changed. Run the same config about three times before trusting a number.',
    LOAD_ERROR_TITLE: 'Request failed',
    CLOSE: 'Close',

    // Cortex Analyst (semantic view) evals
    TAB_ANALYST: 'Analyst (semantic view)',
    ANALYST_SUBTITLE: 'Test a semantic view against its own verified queries. Cortex Analyst answers each question, and a judge compares the SQL it generates with the verified one (sql_correctness).',
    VIEW_LABEL: 'Semantic view',
    VIEWS_LOADING: 'Loading semantic views…',
    NO_VIEWS: 'No semantic views found in this database and schema.',
    GENERATE_LABEL: 'Create the config file from this form',
    GENERATE_HELP: 'Writes <stage>/<run name>.yaml with the WRITE_TO_STAGE helper procedure, then starts the run. Turn off to use a config file that already exists.',
    STAGE_LABEL: 'Config stage',
    STAGE_HELPER: 'A stage, not a file, e.g. @SALES_EVAL_DB.DATA.EVAL_CONFIGS',
    STAGE_INVALID: 'Must start with @ and name a stage, with no .yaml file name.',
    METRIC_VERSION_LABEL: 'sql_correctness version',
    METRIC_VERSION_HELPER: 'Pick v3 unless you have a reason not to. v1 uses the legacy claude-4-sonnet judge (legacy since Aug 12, 2026). Scores are not comparable across versions.',
    QUESTIONS_LABEL: 'Verified queries to evaluate (optional)',
    QUESTIONS_HELPER: 'One question per line, exactly as written in the verified query. Leave empty to use all of them. Selected queries are removed from a temporary copy of the view during the run, so the model cannot look the answer up.',
    ANALYST_RUNS_EMPTY: 'No runs tracked for this semantic view yet. Start one above.',
    SQL_CORRECTNESS: 'SQL correctness',
    SQL_CORRECTNESS_CAPTION: 'average of per-query scores',
    QUERIES_EVALUATED: 'Queries evaluated',
    BELOW_THRESHOLD: (threshold: number) => `Below ${threshold}`,
    AVG_LATENCY: 'Avg response time',
    DETAILS: 'Details',
    DETAILS_TITLE: 'Evaluation detail',
    EXPECTED_SQL: 'Expected',
    GENERATED: 'Response',

    // Run control
    CANCEL_RUN: 'Cancel run',
    CANCEL_CONFIRM: 'Cancel this run? Results gathered so far stay in Snowflake.',
    STATUS_ERRORS_TITLE: 'Snowflake reported errors for this run',
    POLL_NOTE: 'Runs that are in progress are checked every 30 seconds.',

    // Run comparison
    COMPARE_LABEL: 'Compare with',
    COMPARE_NONE: 'No comparison',
    COMPARE_TITLE: 'Comparison',
    COMPARE_NO_MATCH: 'No questions in common with the baseline run, so there is nothing to compare.',
    COMPARE_NO_CHANGES: (threshold: number) => `No question crossed the ${threshold} line between these runs.`,
    REGRESSIONS: (n: number) => `${n} regression${n === 1 ? '' : 's'}: passed in the baseline, fails now`,
    IMPROVEMENTS: (n: number) => `${n} improvement${n === 1 ? '' : 's'}: failed in the baseline, passes now`,
  },

  // Message Labels
  MESSAGE_LABELS: {
    USER: 'You',
    ASSISTANT: 'Snowflake Cortex Agent',
    COPY_USER_MESSAGE_TOOLTIP: 'Copy question to clipboard',
    COPY_ASSISTANT_MESSAGE_TOOLTIP: 'Copy final response text to clipboard',
    COPY_SUCCESS: 'Copied to clipboard!',
    RESEND_MESSAGE_TOOLTIP: 'Ask again',
    DISCLAIMER: 'Agents can make mistakes, double-check responses.',
    SOURCES_LABEL: 'Sources:'
  },

  // Response Headers and Analysis
  RESPONSE: {
    HEADER: {
      TITLE: 'Snowflake Cortex Agent Response'
    }
  },

  // Status Messages
  STATUS: {
    READY: '✅ Ready',
    AI_THINKING: '💭 Snowflake Cortex Agent is processing your request...',
    CONNECTED: 'Connected',
    DISCONNECTED: 'Disconnected',
    LOADING: 'Loading...',
    LOADING_CONFIG: 'Refreshing data agents. Please wait...',
    SENDING: 'Sending...',
    ERROR: 'Error occurred'
  },

  // API Default Messages (fallbacks only)
  API_DEFAULTS: {
    INITIALIZING: 'Initializing...',
    PROCESSING_RESULTS: 'Processing results...'
  },

  // Error Messages
  ERRORS: {
    CONNECTION_FAILED: 'Connection Error: Failed to connect to agent. Please check your configuration.',
    API_ERROR: 'API Error',
    UNKNOWN_ERROR: 'Unknown error',
    UNKNOWN_ERROR_OCCURRED: 'Unknown error occurred',
    NETWORK_ERROR: 'Network connection error',
    TIMEOUT_ERROR: 'Request timed out',
    CONNECTION_ERROR_PREFIX: 'Connection Error: ',
    NO_READABLE_STREAM: 'No readable stream available',
    RESPONSE_COMPLETED: 'Response completed',
    // Error Formatting
    ERROR_PREFIX: 'PAWS right there! We have hit a snag :(',
    HTTP_ERROR_STATUS: 'HTTP Code:',
    USER_CANCELED: 'User canceled the request',
    
    // HTTP Status Codes
    HTTP_STATUS: {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      NOT_FOUND: 404,
      SERVICE_UNAVAILABLE: 503
    },
    
    // Agent Configuration Errors
    RETRY_CONNECTION: 'Retry Now',
    ENV_CONFIG_REQUIRED: '⚠️ Environment Configuration Required',
    ENV_VALUES_MAY_BE_INCORRECT: '⚠️ Configuration values may be incorrect',
    RESTART_SERVER_COMMAND: 'Run: npm start',
    ENV_UPDATE_STEPS: 'Steps to fix:\n1. Stop the development server (Ctrl+C)\n2. Update the .env file with the correct environment variables\n3. Restart the development server (npm start)',
    ENV_CHECK_STEPS: 'If the error persists:\n1. Verify all environment variable VALUES are correct (no typos)\n2. Check that your Snowflake account, host, and credentials are accurate\n3. Ensure the PAT (Personal Access Token) is valid and not expired\n4. After making changes, restart the server (Ctrl+C, then npm start)',
    
    // No Agents Available
    NO_AGENTS_TITLE: 'No Agents Available',
    NO_AGENTS_MESSAGE: 'No Snowflake Cortex Agents were found in your account. Please create at least one agent to use this application.',
    NO_AGENTS_HELP: 'Visit the Snowflake documentation to learn how to create and configure Cortex Agents.',
    REFRESH_AGENTS: 'Refresh Agents'
  },

  // Connection Test
  CONNECTION_TEST: {
    TITLE: '🔧 Connection Test',
    BUTTON_TEST: 'Test Connection',
    BUTTON_BACK: '💬 Back to Chat',
    TESTING: 'Testing connection...',
    SUCCESS: 'Connection successful!',
    FAILED: 'Connection failed'
  },



  // Conversation Management
  CONVERSATION: {
    CONVERSATIONS_LABEL: 'Conversations',
    MESSAGES_LABEL: 'Messages',
    API_STATUS: 'API'
  }
};

// Export individual sections for easier imports
export const HEADER_TEXT = TEXT_CONSTANTS.HEADER;
export const CHAT_TEXT = TEXT_CONSTANTS.CHAT;
export const CREATE_AGENT_TEXT = TEXT_CONSTANTS.CREATE_AGENT;
export const MCP_TOOLS_TEXT = TEXT_CONSTANTS.MCP_TOOLS;
export const EVALS_TEXT = TEXT_CONSTANTS.EVALS;
export const MESSAGE_LABELS = TEXT_CONSTANTS.MESSAGE_LABELS;
export const RESPONSE_TEXT = TEXT_CONSTANTS.RESPONSE;
export const STATUS_TEXT = TEXT_CONSTANTS.STATUS;
export const API_DEFAULTS = TEXT_CONSTANTS.API_DEFAULTS;
export const ERROR_TEXT = TEXT_CONSTANTS.ERRORS;

// Helper function to get raw API status messages (no translation)
export const getApiStatusMessage = (statusMessage: string): string => {
  // Return the raw API message as-is, no translation
  return statusMessage || 'Processing...';
};

// Helper function to get dynamic response subtitle from content
export const getResponseSubtitle = (messageText: string): string => {
  if (!messageText) return '';
  
  // Extract the first meaningful sentence or phrase as subtitle
  const sentences = messageText.trim().split(/[.!?]+/);
  const firstSentence = sentences[0]?.trim();
  
  if (firstSentence && firstSentence.length > 10) {
    // If sentence is too long, extract a meaningful summary
    if (firstSentence.length > 120) {
      // Take first meaningful phrase (up to 80 chars)
      const truncated = firstSentence.substring(0, 80).trim();
      const lastSpace = truncated.lastIndexOf(' ');
      const summary = lastSpace > 30 ? truncated.substring(0, lastSpace) : truncated;
      return `${summary}...`;
    } else {
      // Sentence is good length, use it
      return firstSentence.endsWith(':') ? firstSentence : `${firstSentence}:`;
    }
  }
  
  // Fallback: create a simple summary from the first few words
  const words = messageText.trim().split(/\s+/).slice(0, 10);
  if (words.length >= 3) {
    const summary = words.join(' ');
    if (summary.length < 80) {
      return `${summary}...`;
    }
  }
  
  return 'Response:';
};

export default TEXT_CONSTANTS;
