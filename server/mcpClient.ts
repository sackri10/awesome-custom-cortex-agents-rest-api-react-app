/**
 * Snowflake-managed MCP client
 *
 * Talks to a Snowflake MCP SERVER object over JSON-RPC HTTP.
 * Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp
 *
 * Auth matches the existing Express proxy (PAT + PROGRAMMATIC_ACCESS_TOKEN).
 * Snowflake MCP only supports tools/list and tools/call (no lifecycle/resources).
 */

export interface McpClientConfig {
  host: string;
  pat: string;
  database: string;
  schema: string;
  mcpServer: string;
}

export interface McpJsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  items?: McpJsonSchemaProperty;
  properties?: Record<string, McpJsonSchemaProperty>;
  required?: string[];
  enum?: unknown[];
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: McpJsonSchemaProperty;
  [key: string]: unknown;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: McpJsonRpcError;
}

export interface McpToolsListResult {
  tools: McpTool[];
}

export interface McpToolsCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
}

export class SnowflakeMcpError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'SnowflakeMcpError';
    this.status = status;
    this.body = body;
  }
}

let rpcId = 1;
const nextId = (): number => rpcId++;

const authHeaders = (pat: string): Record<string, string> => ({
  'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
  Authorization: `Bearer ${pat}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

const buildEndpoint = (config: McpClientConfig): string => {
  const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    `https://${host}/api/v2/databases/${encodeURIComponent(config.database)}` +
    `/schemas/${encodeURIComponent(config.schema)}` +
    `/mcp-servers/${encodeURIComponent(config.mcpServer)}`
  );
};

export class SnowflakeMcpClient {
  private readonly config: McpClientConfig;
  private readonly endpoint: string;

  constructor(config: McpClientConfig) {
    this.config = config;
    this.endpoint = buildEndpoint(config);
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const payload = {
      jsonrpc: '2.0' as const,
      id: nextId(),
      method,
      params,
    };

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: authHeaders(this.config.pat),
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SnowflakeMcpError(`Failed to reach Snowflake MCP server: ${message}`, 503);
    }

    const contentType = response.headers.get('content-type') || '';
    let body: McpJsonRpcResponse<T> | Record<string, unknown> | string | null = null;

    if (contentType.includes('application/json')) {
      body = (await response.json()) as McpJsonRpcResponse<T>;
    } else {
      body = await response.text();
    }

    if (!response.ok) {
      const detail =
        typeof body === 'object' && body !== null
          ? (body as { message?: string; error?: string }).message ||
            (body as { error?: string }).error ||
            JSON.stringify(body)
          : String(body);
      throw new SnowflakeMcpError(
        `Snowflake MCP HTTP ${response.status}: ${detail}`,
        response.status,
        body
      );
    }

    const rpcBody = body as McpJsonRpcResponse<T>;
    if (rpcBody?.error) {
      throw new SnowflakeMcpError(
        `MCP error ${rpcBody.error.code}: ${rpcBody.error.message}`,
        400,
        rpcBody.error
      );
    }

    return rpcBody.result as T;
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc<McpToolsListResult>('tools/list', {});
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolsCallResult> {
    return this.rpc<McpToolsCallResult>('tools/call', {
      name,
      arguments: args,
    });
  }
}

export const createSnowflakeMcpClient = (config: McpClientConfig): SnowflakeMcpClient => {
  const required: Array<keyof McpClientConfig> = ['host', 'pat', 'database', 'schema', 'mcpServer'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing MCP client config: ${missing.join(', ')}`);
  }
  return new SnowflakeMcpClient(config);
};
