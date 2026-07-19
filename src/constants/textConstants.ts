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
