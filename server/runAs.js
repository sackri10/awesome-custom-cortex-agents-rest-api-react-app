/**
 * "Run as role": call a Cortex Agent as a chosen Snowflake role, so the answer reflects
 * only what that role can see.
 *
 * How Snowflake decides (see cortex_agent_role_based_access.md): every agent run takes the
 * caller's role from the X-Snowflake-Role header, and drops each Cortex Analyst tool whose
 * semantic view the role has no privilege on (tool_not_accessible: accept). Nothing here
 * filters answers itself; it only picks the role the request runs under.
 *
 * Opt-in and allowlisted. RUN_AS_ROLES lists the roles the browser may choose, so the
 * proxy can never be asked to act as ACCOUNTADMIN or any role you didn't name. Each role
 * authenticates one of two ways:
 *
 *   header : the shared SNOWFLAKE_PAT plus X-Snowflake-Role. Works only if that PAT is not
 *            restricted to a single role (a restricted PAT answers "not permitted for the
 *            credentials being used").
 *   token  : a PAT restricted to that role, in RUN_AS_PAT_<ROLE>. Least privilege, and the
 *            proxy still can't act as any role you haven't minted a token for.
 */

const { createSqlClient } = require('./evalsClient');

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const FQN = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*){2}$/;

const patEnvName = (role) => `RUN_AS_PAT_${role.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;

const createRunAs = ({ host, pat, database, schema, env = process.env, ttlMs = 60000 }) => {
  const roles = [...new Set(
    (env.RUN_AS_ROLES || '').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean)
  )];
  const invalid = roles.filter((r) => !IDENT.test(r));
  if (invalid.length) {
    throw new Error(`RUN_AS_ROLES has invalid role names: ${invalid.join(', ')}`);
  }

  const ownToken = (role) => !!env[patEnvName(role)];
  const patFor = (role) => env[patEnvName(role)] || pat;

  /** Map a requested role name to its credentials, or null when it isn't allowlisted. */
  const resolve = (name) => {
    const role = String(name || '').trim().toUpperCase();
    return roles.includes(role) ? { role, pat: patFor(role) } : null;
  };

  /** Auth headers for a REST call made as this role. */
  const headersFor = ({ role, pat: token }) => ({
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    'Authorization': `Bearer ${token}`,
    'X-Snowflake-Role': role,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  });

  // SQL API client that runs as a role (no warehouse: the checks below are metadata only)
  const sqlAs = (role) => createSqlClient({ host, pat: patFor(role), database, schema, role });
  const sqlDefault = () => createSqlClient({ host, pat, database, schema });

  /** Can the proxy actually become this role with its credential? */
  const checkUsable = async (role) => {
    try {
      const rows = await sqlAs(role).execute('SELECT CURRENT_ROLE() AS R');
      const got = String((rows[0] && rows[0].R) || '').toUpperCase();
      return got === role ? { usable: true } : { usable: false, reason: `Session ran as ${got || 'an unknown role'}, not ${role}.` };
    } catch (error) {
      const restricted = /not permitted for the credentials/i.test(error.message);
      return {
        usable: false,
        reason: error.message,
        hint: restricted && !ownToken(role)
          ? `The shared token is restricted to one role. Add ${patEnvName(role)} (a token restricted to ${role}) to the backend .env, or use a token that isn't role-restricted.`
          : undefined,
      };
    }
  };

  /** Users who hold the role (so the UI can offer "run as <user>"). */
  const usersFor = async (role, me) => {
    const rows = await sqlDefault().execute(`SHOW GRANTS OF ROLE ${role}`);
    return rows
      .filter((r) => String(r.granted_to).toUpperCase() === 'USER' && String(r.grantee_name).toUpperCase() !== me)
      .map((r) => String(r.grantee_name));
  };

  let cache = null;
  let cachedAt = 0;

  /** Allowlisted roles with usability and holders, cached briefly. */
  const list = async ({ fresh = false } = {}) => {
    if (!fresh && cache && Date.now() - cachedAt < ttlMs) return cache;
    let me = '';
    try {
      const rows = await sqlDefault().execute('SELECT CURRENT_USER() AS U');
      me = String((rows[0] && rows[0].U) || '').toUpperCase();
    } catch { /* leave empty: the app's own user then also appears in the holders list */ }

    const items = await Promise.all(roles.map(async (role) => {
      const [usable, users] = await Promise.all([checkUsable(role), usersFor(role, me).catch(() => [])]);
      return { role, mode: ownToken(role) ? 'token' : 'header', ...usable, users };
    }));
    cache = items;
    cachedAt = Date.now();
    return items;
  };

  /**
   * For each tool in an agent spec, does `role` have access to the object behind it?
   * DESCRIBE succeeds only with a privilege on the object, which is the same test
   * Snowflake applies before it drops a tool in tool_not_accessible: accept mode.
   */
  const toolAccess = async (role, agentSpec) => {
    const spec = typeof agentSpec === 'string' ? JSON.parse(agentSpec) : (agentSpec || {});
    const resources = spec.tool_resources || {};
    const client = sqlAs(role);

    return Promise.all((spec.tools || []).map(async (tool) => {
      const toolSpec = tool.tool_spec || {};
      const res = resources[toolSpec.name] || {};
      const target = res.semantic_view
        ? { kind: 'semantic view', fqn: res.semantic_view, sql: 'DESCRIBE SEMANTIC VIEW' }
        : res.search_service
          ? { kind: 'search service', fqn: res.search_service, sql: 'DESCRIBE CORTEX SEARCH SERVICE' }
          : null;
      const base = { tool: toolSpec.name, type: toolSpec.type, resource: target ? target.fqn : null, resourceKind: target ? target.kind : null };
      if (!target) return { ...base, accessible: null, reason: 'Not backed by a semantic view or search service, so it cannot be checked here.' };
      if (!FQN.test(target.fqn)) return { ...base, accessible: null, reason: 'Name uses quoting or is not fully qualified, so it cannot be checked here.' };
      try {
        await client.execute(`${target.sql} ${target.fqn}`);
        return { ...base, accessible: true };
      } catch (error) {
        return { ...base, accessible: false, reason: error.message };
      }
    }));
  };

  return {
    enabled: roles.length > 0,
    roles,
    resolve,
    headersFor,
    list,
    toolAccess,
  };
};

module.exports = { createRunAs, patEnvName };
