/**
 * Snowflake MCP API Service
 *
 * Frontend calls our secure backend proxy, which talks to the Snowflake-managed
 * MCP server (tools/list + tools/call). PAT never leaves the server.
 */

import { config } from '../config/env';
import { ERROR_TEXT } from '../constants/textConstants';

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
}

export interface McpContext {
  configured: boolean;
  database: string;
  schema: string;
  mcpServer: string | null;
  endpoint: string | null;
}

export interface McpToolsCallResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
}

const handleResponse = async (response: Response): Promise<any> => {
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errorJson = await response.json();
      const errorMessage = errorJson.errorParts
        ? errorJson.errorParts.join('\n\n')
        : (typeof errorJson.error === 'string'
            ? errorJson.error
            : (errorJson.error?.message || errorJson.message || JSON.stringify(errorJson, null, 2)));
      const error = new Error(errorMessage);
      (error as any).fullMessage = errorMessage;
      throw error;
    }
    const errorMessage = `${ERROR_TEXT.ERROR_PREFIX}\n${ERROR_TEXT.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`;
    const error = new Error(errorMessage);
    (error as any).fullMessage = errorMessage;
    throw error;
  }
  return response.json();
};

const connectionError = (): Error => {
  const errorMessage =
    `${ERROR_TEXT.ERROR_PREFIX}\n\nFailed to connect to the backend server.\n\n` +
    `💡 Tip: The backend server at ${config.backendUrl} is not running or not accessible.`;
  const error = new Error(errorMessage);
  (error as any).fullMessage = errorMessage;
  return error;
};

export const fetchMcpContext = async (): Promise<McpContext> => {
  try {
    const response = await fetch(`${config.backendUrl}/api/mcp/context`);
    return handleResponse(response);
  } catch (error: any) {
    if (error.fullMessage) throw error;
    throw connectionError();
  }
};

export const listMcpTools = async (): Promise<McpTool[]> => {
  try {
    const response = await fetch(`${config.backendUrl}/api/mcp/tools`);
    const data = await handleResponse(response);
    return data.tools || [];
  } catch (error: any) {
    if (error.fullMessage) throw error;
    throw connectionError();
  }
};

export const callMcpTool = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpToolsCallResult> => {
  try {
    const response = await fetch(`${config.backendUrl}/api/mcp/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    });
    const data = await handleResponse(response);
    return data.result;
  } catch (error: any) {
    if (error.fullMessage) throw error;
    throw connectionError();
  }
};
