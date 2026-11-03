/**
 * Run-as-role API Service
 *
 * Lets the chat call a Cortex Agent as a chosen Snowflake role, so the answer reflects only
 * what that role can see (see cortex_agent_role_based_access.md). The chosen role travels in
 * an X-Run-As-Role header. The backend only honors roles listed in RUN_AS_ROLES, and
 * Snowflake itself decides which tools that role can reach.
 *
 * The selection is held in memory only, on purpose: a page reload goes back to the app's
 * default role, so a leftover role can never leave you stuck on a screen that role cannot use.
 */

import { config } from '../config/env';
import { ERROR_TEXT } from '../constants/textConstants';
import { scopeHeaders } from './requestScope';

export interface RunAsSelection {
  /** Snowflake role to run as. Empty string = the app's default role. */
  role: string;
  /** Set when the role was picked through a user who holds it (display only) */
  user?: string;
}

export interface RunAsRole {
  role: string;
  /** token: a PAT restricted to this role. header: shared PAT plus X-Snowflake-Role. */
  mode: 'token' | 'header';
  /** Can the proxy actually become this role right now? */
  usable: boolean;
  reason?: string;
  hint?: string;
  /** Users who hold the role */
  users: string[];
}

export interface RunAsConfig {
  enabled: boolean;
  roles: RunAsRole[];
}

export interface ToolAccess {
  tool: string;
  type?: string;
  resource: string | null;
  resourceKind: 'semantic view' | 'search service' | null;
  /** true: reachable. false: Snowflake would drop the tool. null: could not be checked. */
  accessible: boolean | null;
  reason?: string;
}

let selection: RunAsSelection = { role: '' };
let cachedConfig: RunAsConfig | null = null;

export const getRunAs = (): RunAsSelection => selection;
export const getRunAsRole = (): string => selection.role;

export const setRunAs = (next: RunAsSelection): void => {
  selection = { role: next.role, user: next.user };
};

/** Headers to add to any call that should run as the selected role. */
export const runAsHeaders = (): Record<string, string> =>
  selection.role ? { 'X-Run-As-Role': selection.role } : {};

/** Everything that scopes a backend call: the chosen database and schema, and the role. */
export const apiHeaders = (): Record<string, string> => ({ ...scopeHeaders(), ...runAsHeaders() });

const failure = (message: string): Error => {
  const error = new Error(message);
  (error as any).fullMessage = message;
  return error;
};

const handleResponse = async (response: Response): Promise<any> => {
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      throw failure(
        body.errorParts
          ? body.errorParts.join('\n\n')
          : (typeof body.error === 'string' ? body.error : (body.error?.message || body.message || JSON.stringify(body)))
      );
    }
    throw failure(`${ERROR_TEXT.ERROR_PREFIX}\n${ERROR_TEXT.HTTP_ERROR_STATUS} ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const connectionError = (): Error =>
  failure(
    `${ERROR_TEXT.ERROR_PREFIX}\n\nFailed to connect to the backend server.\n\n` +
    `💡 Tip: The backend server at ${config.backendUrl} is not running or not accessible.`
  );

const get = async (path: string, headers: Record<string, string> = {}): Promise<any> => {
  try {
    return await handleResponse(await fetch(`${config.backendUrl}${path}`, { headers: { Accept: 'application/json', ...apiHeaders(), ...headers } }));
  } catch (error: any) {
    if (error.fullMessage) throw error;
    throw connectionError();
  }
};

/** Roles the chat may run as. Pass refresh to re-check which of them the proxy can use. */
export const fetchRunAsConfig = async (refresh = false): Promise<RunAsConfig> => {
  cachedConfig = await get(`/api/run-as${refresh ? '?refresh=1' : ''}`);
  return cachedConfig as RunAsConfig;
};

/** Last fetched role list, so the bar can render at once when it is remounted. */
export const getCachedRunAsConfig = (): RunAsConfig | null => cachedConfig;

/** Which of the agent's tools the role can reach (what Snowflake keeps or drops at run time). */
export const fetchAgentAccess = async (agentName: string, role: string): Promise<ToolAccess[]> => {
  const data = await get(`/api/agents/${encodeURIComponent(agentName)}/access`, { 'X-Run-As-Role': role });
  return data.tools || [];
};
