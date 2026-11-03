/**
 * Request scope: the Snowflake database and schema the app works in.
 *
 * Picked in the UI instead of being fixed in the backend .env. The backend reads them from
 * the X-Snowflake-Database / X-Snowflake-Schema headers on each request; SNOWFLAKE_DATABASE
 * and SNOWFLAKE_SCHEMA in .env are only a fallback for when none is chosen.
 *
 * The last choice is remembered in the browser. That is safe here because the scope bar is
 * on every chat screen, including the error and empty ones, so a remembered scope that a role
 * cannot use can always be changed.
 */

export interface RequestScope {
  database: string;
  schema: string;
}

const STORAGE_KEY = 'cortexApp.scope';

const read = (): RequestScope | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.database === 'string' && typeof parsed.schema === 'string'
      ? { database: parsed.database, schema: parsed.schema }
      : null;
  } catch {
    return null; // storage unavailable or corrupted: start with no choice
  }
};

let scope: RequestScope | null = read();

/** The chosen database and schema, or null when none has been chosen (backend default applies). */
export const getScope = (): RequestScope | null => scope;

export const setScope = (next: RequestScope | null): void => {
  scope = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable: the choice then lasts until reload */ }
};

/** Headers that tell the backend which database and schema this request is for. */
export const scopeHeaders = (): Record<string, string> =>
  scope ? { 'X-Snowflake-Database': scope.database, 'X-Snowflake-Schema': scope.schema } : {};
