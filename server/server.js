/**
 * Secure Backend Proxy Server for Snowflake Cortex Agents
 * 
 * This server acts as a proxy between the frontend and Snowflake APIs,
 * keeping the Personal Access Token (PAT) secure on the server side.
 * 
 * Security Features:
 * - PAT is never exposed to the browser/client
 * - CORS configured for specific origins
 * - Request validation and sanitization
 * - Rate limiting to prevent abuse
 * - Proper error handling without exposing sensitive info
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { HTTP_STATUS, ERROR_MESSAGES, CONFIG } = require('./constants');
const { buildCreateSearchServiceSql, buildCreateSemanticViewSql } = require('./snowflakeDdl');
const {
  createSnowflakeMcpClient,
  SnowflakeMcpError,
} = require('./mcpClient');

const app = express();
// Render uses PORT, local dev uses SERVER_PORT
const PORT = process.env.PORT || process.env.SERVER_PORT || CONFIG.DEFAULT_PORT;

// ============================================================================
// Configuration & Validation
// ============================================================================

/**
 * Validate required environment variables
 */
const validateEnvironment = () => {
  const required = [
    'SNOWFLAKE_HOST',
    'SNOWFLAKE_PAT',
    'SNOWFLAKE_DATABASE',
    'SNOWFLAKE_SCHEMA'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  console.log('✅ All required environment variables are set');
};

validateEnvironment();

// Snowflake configuration from environment
const SNOWFLAKE_CONFIG = {
  host: process.env.SNOWFLAKE_HOST,
  pat: process.env.SNOWFLAKE_PAT,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  // Optional: only required for CREATE operations (search services / semantic views).
  // Listing and metadata (SHOW commands) run without a warehouse.
  warehouse: process.env.SNOWFLAKE_WAREHOUSE || null,
  // Optional: required for MCP tools/list and tools/call endpoints.
  mcpServer: process.env.SNOWFLAKE_MCP_SERVER || null
};

if (!SNOWFLAKE_CONFIG.warehouse) {
  console.warn('⚠️  SNOWFLAKE_WAREHOUSE is not set. Listing/metadata will work, but creating Cortex Search services and semantic views requires it.');
}

if (!SNOWFLAKE_CONFIG.mcpServer) {
  console.warn('⚠️  SNOWFLAKE_MCP_SERVER is not set. /api/mcp/* endpoints will return 503 until you create an MCP SERVER object and set this env var.');
}

/**
 * Lazy MCP client — only constructed when SNOWFLAKE_MCP_SERVER is configured.
 */
const getMcpClient = () => {
  if (!SNOWFLAKE_CONFIG.mcpServer) {
    return null;
  }
  return createSnowflakeMcpClient({
    host: SNOWFLAKE_CONFIG.host,
    pat: SNOWFLAKE_CONFIG.pat,
    database: SNOWFLAKE_CONFIG.database,
    schema: SNOWFLAKE_CONFIG.schema,
    mcpServer: SNOWFLAKE_CONFIG.mcpServer,
  });
};

const mcpUnavailableResponse = (res) => {
  res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
    errorParts: [
      ERROR_MESSAGES.ERROR_PREFIX,
      'Snowflake MCP is not configured.',
      '💡 Tip: Create an MCP SERVER in Snowflake (see server/sql/create_mcp_server.sql), then set SNOWFLAKE_MCP_SERVER in your backend .env and restart the server.',
    ],
  });
};

const mcpErrorResponse = (res, error) => {
  if (error instanceof SnowflakeMcpError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    const tips = [];
    if (status === 401 || status === 403) tips.push(ERROR_MESSAGES.TIPS.UNAUTHORIZED);
    if (status === 404) {
      tips.push(
        '💡 Tip: Check SNOWFLAKE_MCP_SERVER, SNOWFLAKE_DATABASE, and SNOWFLAKE_SCHEMA. Confirm the MCP SERVER object exists (SHOW MCP SERVERS IN SCHEMA ...).'
      );
    }
    if (status === 503) tips.push(ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE);
    return res.status(status).json({
      errorParts: [ERROR_MESSAGES.ERROR_PREFIX, error.message, ...tips].filter(Boolean),
      details: process.env.NODE_ENV === 'development' ? error.body : undefined,
    });
  }
  return res.status(500).json({ error: sanitizeError(error) });
};

// ============================================================================
// Middleware Configuration
// ============================================================================

/**
 * CORS configuration - restrict to specific origins in production
 */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow localhost
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];
    
    // Check for wildcard (allow all origins)
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️  Blocked request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept']
};

app.use(cors(corsOptions));
app.use(express.json());

/**
 * Rate limiting to prevent abuse
 * Adjust limits based on your needs
 */
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

/**
 * Request logging middleware
 */
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get authentication headers for Snowflake API
 */
const getSnowflakeAuthHeaders = () => ({
  'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  'Authorization': `Bearer ${SNOWFLAKE_CONFIG.pat}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
});

/**
 * Execute a SQL statement via the Snowflake SQL API.
 * Used for SHOW (listing/metadata) and CREATE (search services / semantic views).
 * Returns { ok, status, json }.
 */
const executeSql = async (statement, { includeWarehouse = false } = {}) => {
  const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/statements`;

  const body = {
    statement,
    timeout: 60,
    database: SNOWFLAKE_CONFIG.database,
    schema: SNOWFLAKE_CONFIG.schema,
  };
  if (includeWarehouse && SNOWFLAKE_CONFIG.warehouse) {
    body.warehouse = SNOWFLAKE_CONFIG.warehouse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: getSnowflakeAuthHeaders(),
    body: JSON.stringify(body),
  });

  let json = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { json = await response.json(); } catch { /* ignore */ }
  }

  return { ok: response.ok, status: response.status, json };
};

/**
 * Safely parse a fetch Response body as JSON, tolerating empty / non-JSON bodies
 * (Snowflake sometimes returns 200 with an empty body on updates).
 */
const parseJsonSafe = async (response, fallback = {}) => {
  try {
    const text = await response.text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/**
 * Convert a SQL API result set into an array of row objects keyed by column name.
 */
const rowsToObjects = (json) => {
  if (!json) return [];
  const cols = (json.resultSetMetaData?.rowType || []).map(c => c.name);
  const data = json.data || [];
  return data.map(row => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
};

/**
 * Build a structured error payload from a failed SQL API response.
 */
const sqlErrorParts = (result, extraTip) => {
  const parts = [
    ERROR_MESSAGES.ERROR_PREFIX,
    `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${result.status}`,
  ];
  const message = result.json?.message || result.json?.error;
  if (message) parts.push(message);
  if (extraTip) parts.push(extraTip);
  return parts;
};

/**
 * Guard used by CREATE routes: ensure a warehouse is configured.
 */
const requireWarehouse = (res) => {
  if (!SNOWFLAKE_CONFIG.warehouse) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      errorParts: [
        ERROR_MESSAGES.ERROR_PREFIX,
        ERROR_MESSAGES.TIPS.WAREHOUSE_REQUIRED,
      ],
    });
    return false;
  }
  return true;
};

/**
 * Sanitize error messages to prevent information leakage
 */
const sanitizeError = (error) => {
  // Don't expose internal error details in production
  if (process.env.NODE_ENV === 'production') {
    return {
      message: 'An error occurred while processing your request',
      code: 'INTERNAL_ERROR'
    };
  }
  
  // In development, provide more details (but still sanitize sensitive data)
  return {
    message: error.message?.replace(/Bearer\s+[\w-]+/g, 'Bearer [REDACTED]') || 'Unknown error',
    code: error.code || 'UNKNOWN_ERROR'
  };
};

/**
 * Validate agent name to prevent injection attacks
 */
const validateAgentName = (agentName) => {
  if (!agentName || typeof agentName !== 'string') {
    return false;
  }
  
  // Allow alphanumeric, underscore, hyphen, and dot
  const validPattern = /^[a-zA-Z0-9_\-\.]+$/;
  return validPattern.test(agentName) && agentName.length <= CONFIG.MAX_AGENT_NAME_LENGTH;
};

// ============================================================================
// API Routes
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * List all Cortex Agents
 * GET /api/agents
 */
app.get('/api/agents', async (req, res) => {
  try {
    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/databases/${SNOWFLAKE_CONFIG.database}/schemas/${SNOWFLAKE_CONFIG.schema}/agents`;
    
    console.log('📡 Fetching agents list from Snowflake...');
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: getSnowflakeAuthHeaders(),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      
      // Build error message as array of parts (preserves structure better than string with \n\n)
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`
      ];
      
      // For 400/401, skip error details (they're not helpful)
      // For 404 and others, include Snowflake's error details
      if (response.status !== HTTP_STATUS.BAD_REQUEST && response.status !== HTTP_STATUS.UNAUTHORIZED) {
        if (contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            const details = errorData.error || errorData.message || JSON.stringify(errorData, null, 2);
            errorParts.push(details);
          } catch {
            // JSON parsing failed, use default message
          }
        }
      }
      
      // Add helpful configuration hints based on status code
      if (response.status === HTTP_STATUS.BAD_REQUEST) {
        errorParts.push(ERROR_MESSAGES.TIPS.BAD_REQUEST);
      } else if (response.status === HTTP_STATUS.UNAUTHORIZED) {
        errorParts.push(ERROR_MESSAGES.TIPS.UNAUTHORIZED);
      } else if (response.status === HTTP_STATUS.NOT_FOUND) {
        errorParts.push(ERROR_MESSAGES.TIPS.NOT_FOUND);
      }
      
      console.error('❌ Snowflake API error:', response.status, errorParts.join('\n'));
      
      return res.status(response.status).json({
        errorParts  // Send as array instead of single string
      });
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched ${Array.isArray(data) ? data.length : 'unknown'} agents`);
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching agents:', error.message);
    
    // Check if this is a network error (DNS, connection failed, etc.)
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${HTTP_STATUS.SERVICE_UNAVAILABLE} Service Unavailable`,
        ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE
      ];
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ errorParts });
    }
    
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Create a new Cortex Agent
 * POST /api/agents
 *
 * Body: the Cortex Agent object (name, comment, profile, models, instructions,
 * tools, tool_resources). An optional `_createMode` field ("errorIfExists" |
 * "orReplace") controls whether an existing agent is overwritten.
 */
app.post('/api/agents', async (req, res) => {
  try {
    const body = req.body || {};

    // Pull out create mode (defaults to errorIfExists) and keep it out of the payload
    const createMode = body._createMode === 'orReplace' ? 'orReplace' : 'errorIfExists';
    const agentPayload = { ...body };
    delete agentPayload._createMode;

    // Validate agent name to prevent injection and catch obvious mistakes early
    if (!validateAgentName(agentPayload.name)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: ERROR_MESSAGES.TIPS.INVALID_AGENT_NAME
      });
    }

    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/databases/${SNOWFLAKE_CONFIG.database}/schemas/${SNOWFLAKE_CONFIG.schema}/agents?createMode=${createMode}`;

    console.log(`🛠️  Creating agent: ${agentPayload.name} (createMode=${createMode})`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getSnowflakeAuthHeaders(),
      body: JSON.stringify(agentPayload),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';

      // Build error message as array of parts (preserves structure better than string with \n\n)
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`
      ];

      // Include Snowflake's error details (very helpful for create validation errors)
      if (contentType.includes('application/json')) {
        try {
          const errorData = await response.json();
          const details = errorData.error || errorData.message || JSON.stringify(errorData, null, 2);
          errorParts.push(details);
        } catch {
          // JSON parsing failed, use default message
        }
      }

      // Add helpful configuration hints based on status code
      if (response.status === HTTP_STATUS.BAD_REQUEST) {
        errorParts.push(ERROR_MESSAGES.TIPS.BAD_REQUEST);
      } else if (response.status === HTTP_STATUS.UNAUTHORIZED) {
        errorParts.push(ERROR_MESSAGES.TIPS.UNAUTHORIZED);
      } else if (response.status === HTTP_STATUS.CONFLICT) {
        errorParts.push(ERROR_MESSAGES.TIPS.AGENT_EXISTS(agentPayload.name));
      } else if (response.status === HTTP_STATUS.NOT_FOUND) {
        errorParts.push(ERROR_MESSAGES.TIPS.NOT_FOUND);
      }

      console.error('❌ Snowflake API error:', response.status, errorParts.join('\n'));

      return res.status(response.status).json({
        errorParts  // Send as array instead of single string
      });
    }

    // Snowflake returns a small JSON status message on success (or an empty body)
    const data = await parseJsonSafe(response, { status: `Agent ${agentPayload.name} successfully created.` });

    console.log(`✅ Successfully created agent: ${agentPayload.name}`);

    res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ Error creating agent:', error.message);

    // Check if this is a network error (DNS, connection failed, etc.)
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${HTTP_STATUS.SERVICE_UNAVAILABLE} Service Unavailable`,
        ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE
      ];
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ errorParts });
    }

    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Update (replace) an existing Cortex Agent.
 * PUT /api/agents/:agentName
 *
 * Body: the full Cortex Agent spec (comment, profile, models, instructions,
 * tools, tool_resources). The agent name comes from the URL.
 */
app.put('/api/agents/:agentName', async (req, res) => {
  try {
    const { agentName } = req.params;

    if (!validateAgentName(agentName)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MESSAGES.TIPS.INVALID_AGENT_NAME });
    }

    const agentPayload = { ...(req.body || {}) };
    delete agentPayload._createMode; // not applicable to updates

    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/databases/${SNOWFLAKE_CONFIG.database}/schemas/${SNOWFLAKE_CONFIG.schema}/agents/${agentName}`;

    console.log(`✏️  Updating agent: ${agentName}`);

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: getSnowflakeAuthHeaders(),
      body: JSON.stringify(agentPayload),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`
      ];

      if (contentType.includes('application/json')) {
        try {
          const errorData = await response.json();
          const details = errorData.error || errorData.message || JSON.stringify(errorData, null, 2);
          errorParts.push(details);
        } catch { /* ignore */ }
      }

      if (response.status === HTTP_STATUS.BAD_REQUEST) {
        errorParts.push(ERROR_MESSAGES.TIPS.BAD_REQUEST);
      } else if (response.status === HTTP_STATUS.UNAUTHORIZED) {
        errorParts.push(ERROR_MESSAGES.TIPS.UNAUTHORIZED);
      } else if (response.status === HTTP_STATUS.NOT_FOUND) {
        errorParts.push(ERROR_MESSAGES.TIPS.NOT_FOUND_AGENT(agentName));
      }

      console.error('❌ Snowflake API error:', response.status, errorParts.join('\n'));
      return res.status(response.status).json({ errorParts });
    }

    const data = await parseJsonSafe(response, { status: `Agent ${agentName} successfully updated.` });

    console.log(`✅ Successfully updated agent: ${agentName}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ Error updating agent:', error.message);
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${HTTP_STATUS.SERVICE_UNAVAILABLE} Service Unavailable`,
        ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE
      ];
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ errorParts });
    }
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Create a conversation thread (Snowflake maintains history server-side).
 * POST /api/threads   body: { origin_application? }
 * → Snowflake POST /api/v2/cortex/threads
 */
app.post('/api/threads', async (req, res) => {
  try {
    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/cortex/threads`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getSnowflakeAuthHeaders(),
      body: JSON.stringify({ origin_application: (req.body && req.body.origin_application) || 'dash-desai' }),
    });

    if (!response.ok) {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`,
      ];
      const errData = await parseJsonSafe(response, null);
      if (errData && (errData.message || errData.error)) errorParts.push(errData.message || errData.error);
      console.error('❌ Snowflake thread error:', response.status, errorParts.join('\n'));
      return res.status(response.status).json({ errorParts });
    }

    const data = await parseJsonSafe(response, {});
    console.log(`🧵 Created thread: ${data.thread_id}`);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ Error creating thread:', error.message);
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        errorParts: [ERROR_MESSAGES.ERROR_PREFIX, ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE],
      });
    }
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Describe a thread (its messages / history).
 * GET /api/threads/:threadId
 * → Snowflake GET /api/v2/cortex/threads/{threadId}
 */
app.get('/api/threads/:threadId', async (req, res) => {
  try {
    const { threadId } = req.params;
    if (!/^\d+$/.test(threadId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid thread id' });
    }

    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/cortex/threads/${threadId}`;
    const response = await fetch(endpoint, { method: 'GET', headers: getSnowflakeAuthHeaders() });

    if (!response.ok) {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`,
      ];
      const errData = await parseJsonSafe(response, null);
      if (errData && (errData.message || errData.error)) errorParts.push(errData.message || errData.error);
      return res.status(response.status).json({ errorParts });
    }

    const data = await parseJsonSafe(response, {});
    res.status(response.status).json(data);
  } catch (error) {
    console.error('❌ Error describing thread:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Return non-sensitive Snowflake context used to pre-fill the builder forms.
 * GET /api/context
 */
app.get('/api/context', (req, res) => {
  res.json({
    database: SNOWFLAKE_CONFIG.database,
    schema: SNOWFLAKE_CONFIG.schema,
    warehouse: SNOWFLAKE_CONFIG.warehouse,
    warehouseConfigured: !!SNOWFLAKE_CONFIG.warehouse,
  });
});

/**
 * Helper to validate an optional identifier from a query param, falling back
 * to the configured default. Returns null (and sends a 400) when invalid.
 */
const resolveIdentParam = (value, fallback, label, res) => {
  const candidate = (value && String(value).trim()) || fallback;
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(candidate)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({ error: `Invalid ${label}` });
    return null;
  }
  return candidate;
};

/**
 * List semantic views in a schema (defaults to the configured database/schema).
 * GET /api/semantic-views
 */
app.get('/api/semantic-views', async (req, res) => {
  try {
    const database = resolveIdentParam(req.query.database, SNOWFLAKE_CONFIG.database, 'database', res);
    if (!database) return;
    const schema = resolveIdentParam(req.query.schema, SNOWFLAKE_CONFIG.schema, 'schema', res);
    if (!schema) return;

    console.log(`📡 Listing semantic views in ${database}.${schema}...`);
    const result = await executeSql(`SHOW SEMANTIC VIEWS IN SCHEMA ${database}.${schema}`);

    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result, ERROR_MESSAGES.TIPS.BAD_REQUEST) });
    }

    const rows = rowsToObjects(result.json).map(r => ({
      name: r.name,
      database_name: r.database_name,
      schema_name: r.schema_name,
      comment: r.comment || '',
      created_on: r.created_on,
      fqn: `${r.database_name}.${r.schema_name}.${r.name}`,
    }));
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing semantic views:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * List Cortex Search services in a schema (defaults to the configured database/schema).
 * GET /api/cortex-search-services
 */
app.get('/api/cortex-search-services', async (req, res) => {
  try {
    const database = resolveIdentParam(req.query.database, SNOWFLAKE_CONFIG.database, 'database', res);
    if (!database) return;
    const schema = resolveIdentParam(req.query.schema, SNOWFLAKE_CONFIG.schema, 'schema', res);
    if (!schema) return;

    console.log(`📡 Listing Cortex Search services in ${database}.${schema}...`);
    const result = await executeSql(`SHOW CORTEX SEARCH SERVICES IN SCHEMA ${database}.${schema}`);

    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result, ERROR_MESSAGES.TIPS.BAD_REQUEST) });
    }

    const rows = rowsToObjects(result.json).map(r => ({
      name: r.name,
      database_name: r.database_name,
      schema_name: r.schema_name,
      comment: r.comment || '',
      created_on: r.created_on,
      fqn: `${r.database_name}.${r.schema_name}.${r.name}`,
    }));
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing Cortex Search services:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * List tables & views in a schema (source objects for the builders).
 * GET /api/metadata/tables?database=&schema=
 */
app.get('/api/metadata/tables', async (req, res) => {
  try {
    const database = resolveIdentParam(req.query.database, SNOWFLAKE_CONFIG.database, 'database', res);
    if (!database) return;
    const schema = resolveIdentParam(req.query.schema, SNOWFLAKE_CONFIG.schema, 'schema', res);
    if (!schema) return;

    const result = await executeSql(`SHOW OBJECTS IN SCHEMA ${database}.${schema}`);
    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result, ERROR_MESSAGES.TIPS.BAD_REQUEST) });
    }

    const rows = rowsToObjects(result.json)
      .filter(r => ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'BASE TABLE'].includes(String(r.kind || '').toUpperCase()))
      .map(r => ({
        name: r.name,
        kind: r.kind,
        database_name: r.database_name,
        schema_name: r.schema_name,
        fqn: `${r.database_name}.${r.schema_name}.${r.name}`,
      }));
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * List columns for a table/view.
 * GET /api/metadata/columns?database=&schema=&table=
 */
app.get('/api/metadata/columns', async (req, res) => {
  try {
    const database = resolveIdentParam(req.query.database, SNOWFLAKE_CONFIG.database, 'database', res);
    if (!database) return;
    const schema = resolveIdentParam(req.query.schema, SNOWFLAKE_CONFIG.schema, 'schema', res);
    if (!schema) return;
    const table = resolveIdentParam(req.query.table, '', 'table', res);
    if (!table) return;

    const result = await executeSql(`SHOW COLUMNS IN TABLE ${database}.${schema}.${table}`);
    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result, ERROR_MESSAGES.TIPS.NOT_FOUND) });
    }

    const rows = rowsToObjects(result.json).map(r => {
      let type = r.data_type;
      try {
        const parsed = JSON.parse(r.data_type);
        type = parsed.type || r.data_type;
      } catch { /* leave as-is */ }
      return { name: r.column_name, type, nullable: r['null?'] };
    });
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing columns:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * List databases (for the object-picker selectors).
 * GET /api/metadata/databases
 */
app.get('/api/metadata/databases', async (req, res) => {
  try {
    const result = await executeSql('SHOW DATABASES');
    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result) });
    }
    const rows = rowsToObjects(result.json).map(r => ({ name: r.name }));
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing databases:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * List schemas in a database (for the object-picker selectors).
 * GET /api/metadata/schemas?database=
 */
app.get('/api/metadata/schemas', async (req, res) => {
  try {
    const database = resolveIdentParam(req.query.database, SNOWFLAKE_CONFIG.database, 'database', res);
    if (!database) return;

    const result = await executeSql(`SHOW SCHEMAS IN DATABASE ${database}`);
    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result) });
    }
    const rows = rowsToObjects(result.json)
      .map(r => ({ name: r.name }))
      .filter(r => r.name && r.name !== 'INFORMATION_SCHEMA');
    res.json({ data: rows });
  } catch (error) {
    console.error('❌ Error listing schemas:', error.message);
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Create a Cortex Search service.
 * POST /api/cortex-search-services
 */
app.post('/api/cortex-search-services', async (req, res) => {
  try {
    if (!requireWarehouse(res)) return;

    let sql;
    try {
      sql = buildCreateSearchServiceSql(req.body || {}, {
        database: SNOWFLAKE_CONFIG.database,
        schema: SNOWFLAKE_CONFIG.schema,
        warehouse: SNOWFLAKE_CONFIG.warehouse,
      });
    } catch (buildError) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        errorParts: [ERROR_MESSAGES.ERROR_PREFIX, buildError.message],
      });
    }

    console.log(`🛠️  Creating Cortex Search service:\n${sql}`);
    const result = await executeSql(sql, { includeWarehouse: true });

    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result) });
    }

    console.log('✅ Cortex Search service created');
    res.status(200).json({ status: 'Cortex Search service created successfully.', sql });
  } catch (error) {
    console.error('❌ Error creating Cortex Search service:', error.message);
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        errorParts: [ERROR_MESSAGES.ERROR_PREFIX, ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE],
      });
    }
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Create a semantic view.
 * POST /api/semantic-views
 */
app.post('/api/semantic-views', async (req, res) => {
  try {
    // Semantic view DDL is pure metadata, but we include the warehouse when set.
    let sql;
    try {
      sql = buildCreateSemanticViewSql(req.body || {}, {
        database: SNOWFLAKE_CONFIG.database,
        schema: SNOWFLAKE_CONFIG.schema,
      });
    } catch (buildError) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        errorParts: [ERROR_MESSAGES.ERROR_PREFIX, buildError.message],
      });
    }

    console.log(`🛠️  Creating semantic view:\n${sql}`);
    const result = await executeSql(sql, { includeWarehouse: true });

    if (!result.ok) {
      return res.status(result.status).json({ errorParts: sqlErrorParts(result) });
    }

    console.log('✅ Semantic view created');
    res.status(200).json({ status: 'Semantic view created successfully.', sql });
  } catch (error) {
    console.error('❌ Error creating semantic view:', error.message);
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        errorParts: [ERROR_MESSAGES.ERROR_PREFIX, ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE],
      });
    }
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Get details for a specific Cortex Agent
 * GET /api/agents/:agentName
 */
app.get('/api/agents/:agentName', async (req, res) => {
  try {
    const { agentName } = req.params;
    
    // Validate agent name to prevent injection
    if (!validateAgentName(agentName)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: ERROR_MESSAGES.TIPS.INVALID_AGENT_NAME
      });
    }
    
    const endpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/databases/${SNOWFLAKE_CONFIG.database}/schemas/${SNOWFLAKE_CONFIG.schema}/agents/${agentName}`;
    
    console.log(`📡 Fetching details for agent: ${agentName}...`);
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: getSnowflakeAuthHeaders(),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      
      // Build error message as array of parts (preserves structure better than string with \n\n)
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`
      ];
      
      // For 400/401, skip error details (they're not helpful)
      // For 404 and others, include Snowflake's error details
      if (response.status !== HTTP_STATUS.BAD_REQUEST && response.status !== HTTP_STATUS.UNAUTHORIZED) {
        if (contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            const details = errorData.error || errorData.message || JSON.stringify(errorData, null, 2);
            errorParts.push(details);
          } catch {
            // JSON parsing failed, use default message
          }
        }
      }
      
      // Add helpful configuration hints based on status code
      if (response.status === HTTP_STATUS.BAD_REQUEST) {
        errorParts.push(ERROR_MESSAGES.TIPS.BAD_REQUEST);
      } else if (response.status === HTTP_STATUS.UNAUTHORIZED) {
        errorParts.push(ERROR_MESSAGES.TIPS.UNAUTHORIZED);
      } else if (response.status === HTTP_STATUS.NOT_FOUND) {
        errorParts.push(ERROR_MESSAGES.TIPS.NOT_FOUND_AGENT(agentName));
      }
      
      console.error('❌ Snowflake API error:', response.status, errorParts.join('\n'));
      
      return res.status(response.status).json({
        errorParts  // Send as array instead of single string
      });
    }

    const data = await response.json();
    console.log(`✅ Successfully fetched details for agent: ${agentName}`);
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching agent details:', error.message);
    
    // Check if this is a network error (DNS, connection failed, etc.)
    if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${HTTP_STATUS.SERVICE_UNAVAILABLE} Service Unavailable`,
        ERROR_MESSAGES.TIPS.SERVICE_UNAVAILABLE
      ];
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ errorParts });
    }
    
    res.status(500).json({ error: sanitizeError(error) });
  }
});

/**
 * Send message to Cortex Agent (streaming endpoint)
 * POST /api/agents/:agentName/messages
 */
app.post('/api/agents/:agentName/messages', async (req, res) => {
  try {
    const { agentName } = req.params;
    const requestBody = req.body;
    
    // Validate inputs
    if (!validateAgentName(agentName)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MESSAGES.TIPS.INVALID_AGENT_NAME });
    }
    
    // Validate request body has messages
    if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MESSAGES.TIPS.MESSAGES_REQUIRED });
    }
    
    console.log(`💬 Sending message to agent: ${agentName}`);
    
    // Build Snowflake agent messaging endpoint dynamically
    // Format: https://{host}/api/v2/databases/{db}/schemas/{schema}/agents/{agent}:run
    const agentEndpoint = `https://${SNOWFLAKE_CONFIG.host}/api/v2/databases/${SNOWFLAKE_CONFIG.database}/schemas/${SNOWFLAKE_CONFIG.schema}/agents/${agentName}:run`;
    
    // Make request to Snowflake Agent endpoint
    const response = await fetch(agentEndpoint, {
      method: 'POST',
      headers: getSnowflakeAuthHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      
      // Build error message as array of parts (preserves structure better than string with \n\n)
      const errorParts = [
        ERROR_MESSAGES.ERROR_PREFIX,
        `${ERROR_MESSAGES.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`
      ];
      
      // For 400/401, skip error details (they're not helpful)
      // For 404 and others, include Snowflake's error details
      if (response.status !== HTTP_STATUS.BAD_REQUEST && response.status !== HTTP_STATUS.UNAUTHORIZED) {
        if (contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            console.error('Error details:', errorData)
            const details = errorData.error || errorData.message || JSON.stringify(errorData, null, 2);
            errorParts.push(details);
          } catch {
            // JSON parsing failed, use default message
          }
        }
      }
      
      // Add helpful configuration hints based on status code and content type
      if (response.status === 400) {
        errorParts.push('💡 Tip: Check your SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA in the backend .env file. Make sure they exist and you have access to them.');
      } else if (response.status === 401) {
        errorParts.push('💡 Tip: Check your SNOWFLAKE_PAT (Personal Access Token) in the backend .env file. Make sure it\'s valid and not expired.');
      } else if (response.status === 404) {
        errorParts.push('💡 Tip: Check your SNOWFLAKE_HOST in the backend .env file. Make sure it\'s correct and accessible.');
      }
      
      console.error('❌ Snowflake Agent API error:', response.status, errorParts.join('\n'));
      
      return res.status(response.status).json({
        errorParts  // Send as array instead of single string
      });
    }

    // Check if response is streaming
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('text/event-stream') || contentType?.includes('stream')) {
      // Set headers for SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx
      
      console.log('📡 Streaming response from agent...');
      
      // Use Node.js streams to pipe the response
      const reader = response.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              res.end();
              console.log('✅ Streaming complete');
              break;
            }
            
            // Write chunk to response
            if (!res.write(value)) {
              // Backpressure - wait for drain
              await new Promise(resolve => res.once('drain', resolve));
            }
          }
        } catch (error) {
          console.error('❌ Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Streaming failed' });
          } else {
            res.end();
          }
        }
      };
      
      // Handle client disconnect
      req.on('close', () => {
        console.log('⚠️  Client disconnected');
        reader.cancel();
      });
      
      pump();
    } else {
      // Non-streaming response
      const data = await response.json();
      console.log('✅ Received non-streaming response from agent');
      res.json(data);
    }
  } catch (error) {
    console.error('❌ Error sending message to agent:', error.message);
    
    if (!res.headersSent) {
      // Check if this is a network error (DNS, connection failed, etc.)
      if (error.cause?.code === 'ENOTFOUND' || error.message.includes('fetch failed') || error.cause?.code === 'ECONNREFUSED') {
        const errorParts = [
          ERROR_MESSAGES.ERROR_PREFIX,
          'Failed to connect to Snowflake',
          '💡 Tip: Check your SNOWFLAKE_HOST in the backend .env file. Make sure it\'s correct and accessible (format: account.snowflakecomputing.com)'
        ];
        return res.status(503).json({ errorParts });
      }
      
      res.status(500).json({ error: sanitizeError(error) });
    }
  }
});

/**
 * MCP context (non-sensitive) for the tools demo UI.
 * GET /api/mcp/context
 */
app.get('/api/mcp/context', (req, res) => {
  res.json({
    configured: !!SNOWFLAKE_CONFIG.mcpServer,
    database: SNOWFLAKE_CONFIG.database,
    schema: SNOWFLAKE_CONFIG.schema,
    mcpServer: SNOWFLAKE_CONFIG.mcpServer,
    endpoint: SNOWFLAKE_CONFIG.mcpServer
      ? getMcpClient().getEndpoint()
      : null,
  });
});

/**
 * Discover tools exposed by the Snowflake-managed MCP server.
 * GET /api/mcp/tools
 */
app.get('/api/mcp/tools', async (req, res) => {
  try {
    const client = getMcpClient();
    if (!client) return mcpUnavailableResponse(res);

    console.log(`📡 MCP tools/list → ${client.getEndpoint()}`);
    const tools = await client.listTools();
    res.json({ tools });
  } catch (error) {
    console.error('❌ MCP tools/list failed:', error.message);
    mcpErrorResponse(res, error);
  }
});

/**
 * Invoke a tool on the Snowflake-managed MCP server.
 * POST /api/mcp/tools/call
 * Body: { name: string, arguments?: object }
 */
app.post('/api/mcp/tools/call', async (req, res) => {
  try {
    const client = getMcpClient();
    if (!client) return mcpUnavailableResponse(res);

    const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        errorParts: [
          ERROR_MESSAGES.ERROR_PREFIX,
          'Tool name is required.',
          '💡 Tip: Pass { "name": "<tool_name>", "arguments": { ... } }.',
        ],
      });
    }

    const args =
      req.body && req.body.arguments && typeof req.body.arguments === 'object' && !Array.isArray(req.body.arguments)
        ? req.body.arguments
        : {};

    console.log(`📡 MCP tools/call → ${name}`);
    const result = await client.callTool(name, args);
    res.json({ result });
  } catch (error) {
    console.error('❌ MCP tools/call failed:', error.message);
    mcpErrorResponse(res, error);
  }
});

/**
 * Catch-all for undefined routes
 */
app.use((req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({ 
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: sanitizeError(err) });
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log('\n🚀 Secure Snowflake Proxy Server Started');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Server running on: http://localhost:${PORT}`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏔️  Snowflake Host: ${SNOWFLAKE_CONFIG.host}`);
  console.log(`📊 Database: ${SNOWFLAKE_CONFIG.database}`);
  console.log(`📁 Schema: ${SNOWFLAKE_CONFIG.schema}`);
  console.log(`🧩 MCP Server: ${SNOWFLAKE_CONFIG.mcpServer || '(not configured)'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log('Available endpoints:');
  console.log('  GET  /health                          - Health check');
  console.log('  GET  /api/agents                      - List all agents');
  console.log('  POST /api/agents                      - Create a new agent');
  console.log('  PUT  /api/agents/:agentName           - Update an existing agent');
  console.log('  GET  /api/context                     - Snowflake context (db/schema/warehouse)');
  console.log('  GET  /api/semantic-views              - List semantic views');
  console.log('  POST /api/semantic-views              - Create a semantic view');
  console.log('  GET  /api/cortex-search-services      - List Cortex Search services');
  console.log('  POST /api/cortex-search-services      - Create a Cortex Search service');
  console.log('  GET  /api/metadata/tables             - List tables/views in a schema');
  console.log('  GET  /api/metadata/columns            - List columns of a table');
  console.log('  GET  /api/agents/:agentName           - Get agent details');
  console.log('  POST /api/agents/:agentName/messages  - Send message to agent');
  console.log('  POST /api/threads                     - Create a conversation thread');
  console.log('  GET  /api/threads/:threadId           - Describe a thread (history)');
  console.log('  GET  /api/mcp/context                 - MCP server config status');
  console.log('  GET  /api/mcp/tools                   - MCP tools/list');
  console.log('  POST /api/mcp/tools/call              - MCP tools/call');
  console.log('\n✨ Ready to accept requests!\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

