/**
 * Snowflake Objects API Service
 *
 * Talks to our backend proxy for Snowflake objects used as agent tools:
 * semantic views (Cortex Analyst) and Cortex Search services — including
 * listing existing ones, introspecting tables/columns, and creating new ones.
 */

import { config } from '../config/env';
import { ERROR_TEXT } from '../constants/textConstants';

export interface SnowflakeContext {
  database: string;
  schema: string;
  warehouse: string | null;
  warehouseConfigured: boolean;
  /** Default stage for generated eval configs, e.g. @MY_DB.MY_SCHEMA.EVAL_CONFIGS */
  evalConfigStage?: string;
}

export interface SchemaObject {
  name: string;
  database_name: string;
  schema_name: string;
  comment?: string;
  created_on?: string;
  fqn: string; // fully-qualified name: DB.SCHEMA.NAME
}

export interface TableObject {
  name: string;
  kind: string;
  database_name: string;
  schema_name: string;
  fqn: string;
}

export interface ColumnObject {
  name: string;
  type: string;
  nullable?: string;
}

/**
 * Shared response handler that mirrors the error shape used across the app
 * (errorParts array joined with double newlines, with a `fullMessage` property).
 */
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

const getJson = async (path: string): Promise<any> => {
  const response = await fetch(`${config.backendUrl}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });
  return handleResponse(response);
};

const postJson = async (path: string, body: unknown): Promise<any> => {
  const response = await fetch(`${config.backendUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(response);
};

export const fetchSnowflakeContext = async (): Promise<SnowflakeContext> => {
  return getJson('/api/context');
};

export const listSemanticViews = async (database?: string, schema?: string): Promise<SchemaObject[]> => {
  const params = new URLSearchParams();
  if (database) params.set('database', database);
  if (schema) params.set('schema', schema);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await getJson(`/api/semantic-views${qs}`);
  return data.data || [];
};

export const listCortexSearchServices = async (database?: string, schema?: string): Promise<SchemaObject[]> => {
  const params = new URLSearchParams();
  if (database) params.set('database', database);
  if (schema) params.set('schema', schema);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await getJson(`/api/cortex-search-services${qs}`);
  return data.data || [];
};

export const listDatabases = async (): Promise<string[]> => {
  const data = await getJson('/api/metadata/databases');
  return (data.data || []).map((d: { name: string }) => d.name);
};

export const listSchemas = async (database?: string): Promise<string[]> => {
  const params = new URLSearchParams();
  if (database) params.set('database', database);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await getJson(`/api/metadata/schemas${qs}`);
  return (data.data || []).map((d: { name: string }) => d.name);
};

export const listTables = async (database?: string, schema?: string): Promise<TableObject[]> => {
  const params = new URLSearchParams();
  if (database) params.set('database', database);
  if (schema) params.set('schema', schema);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const data = await getJson(`/api/metadata/tables${qs}`);
  return data.data || [];
};

export const listColumns = async (table: string, database?: string, schema?: string): Promise<ColumnObject[]> => {
  const params = new URLSearchParams();
  params.set('table', table);
  if (database) params.set('database', database);
  if (schema) params.set('schema', schema);
  const data = await getJson(`/api/metadata/columns?${params.toString()}`);
  return data.data || [];
};

// ---- Create payloads ----

export interface CreateSearchServiceRequest {
  name: string;
  database?: string;
  schema?: string;
  orReplace?: boolean;
  searchColumn: string;
  attributes?: string[];
  warehouse?: string;
  targetLag: string;
  embeddingModel?: string;
  comment?: string;
  query: string;
}

export interface SemanticTableSpec {
  alias: string;
  table: string;
  primaryKey?: string[];
  synonyms?: string[];
  comment?: string;
}

export interface SemanticRelationshipSpec {
  name?: string;
  fromAlias: string;
  fromColumns: string[];
  toAlias: string;
  toColumns: string[];
}

export interface SemanticExprSpec {
  alias: string;
  name: string;
  expr: string;
  synonyms?: string[];
  comment?: string;
}

export interface CreateSemanticViewRequest {
  name: string;
  database?: string;
  schema?: string;
  orReplace?: boolean;
  comment?: string;
  tables: SemanticTableSpec[];
  relationships?: SemanticRelationshipSpec[];
  facts?: SemanticExprSpec[];
  dimensions?: SemanticExprSpec[];
  metrics?: SemanticExprSpec[];
}

export const createCortexSearchService = async (payload: CreateSearchServiceRequest): Promise<any> => {
  return postJson('/api/cortex-search-services', payload);
};

export const createSemanticView = async (payload: CreateSemanticViewRequest): Promise<any> => {
  return postJson('/api/semantic-views', payload);
};
