/**
 * Snowflake DDL builders
 *
 * Constructs CREATE CORTEX SEARCH SERVICE and CREATE SEMANTIC VIEW statements
 * from structured input received from the UI. Object/column identifiers are
 * validated (never interpolated blindly) so the client cannot inject arbitrary
 * SQL through a name. Free-form SQL expressions (dimension/metric expressions,
 * the search service source query) are inherently SQL and are inserted as-is —
 * this is an authenticated admin tool backed by a privileged PAT.
 */

// Unquoted Snowflake identifier: starts with letter/underscore, then letters/digits/underscore/$.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Validate a single identifier and return it inlined (unquoted, so Snowflake's
 * normal case-folding applies — matches what users expect when they type a name).
 */
function ident(name, label = 'identifier') {
  if (typeof name !== 'string' || !IDENT_RE.test(name.trim())) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(name)}. Use letters, numbers and underscores only (must start with a letter or underscore).`);
  }
  return name.trim();
}

/**
 * Validate a possibly-qualified identifier (db.schema.object) part-by-part.
 */
function qualified(name, label = 'identifier') {
  const parts = String(name || '').split('.').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Missing ${label}.`);
  }
  return parts.map(p => ident(p, label)).join('.');
}

/** Qualify a bare name with default database/schema; pass through if already qualified. */
function qualifyWithDefaults(name, database, schema) {
  const parts = String(name || '').split('.').map(p => p.trim()).filter(Boolean);
  if (parts.length === 1 && database && schema) {
    return `${ident(database, 'database')}.${ident(schema, 'schema')}.${ident(parts[0], 'name')}`;
  }
  return qualified(name, 'name');
}

/** Escape and single-quote a string literal. */
function literal(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

/** Build "WITH SYNONYMS = ('a', 'b')" or empty string. */
function synonymsClause(synonyms) {
  const list = (synonyms || []).map(s => String(s).trim()).filter(Boolean);
  if (list.length === 0) return '';
  return `WITH SYNONYMS = (${list.map(literal).join(', ')})`;
}

/**
 * Build a CREATE CORTEX SEARCH SERVICE statement.
 * spec: { name, database?, schema?, orReplace?, ifNotExists?, searchColumn, attributes[],
 *         warehouse, targetLag, embeddingModel?, comment?, query }
 */
function buildCreateSearchServiceSql(spec, defaults = {}) {
  const database = spec.database || defaults.database;
  const schema = spec.schema || defaults.schema;
  const name = qualifyWithDefaults(spec.name, database, schema);

  const searchColumn = ident(spec.searchColumn, 'search column');
  const attributes = (spec.attributes || []).map(a => ident(a, 'attribute'));
  const warehouse = ident(spec.warehouse || defaults.warehouse, 'warehouse');

  const targetLag = String(spec.targetLag || '').trim();
  if (!/^\d+\s+(second|minute|hour|day)s?$/i.test(targetLag)) {
    throw new Error(`Invalid TARGET_LAG: "${targetLag}". Use e.g. "1 hour", "30 minutes", "1 day".`);
  }

  const query = String(spec.query || '').trim();
  if (!query) throw new Error('A source query (the AS SELECT ...) is required.');
  if (!/^select\b/i.test(query)) {
    throw new Error('The source query must be a SELECT statement.');
  }

  const orReplace = spec.orReplace ? 'OR REPLACE ' : '';
  const ifNotExists = !spec.orReplace && spec.ifNotExists ? 'IF NOT EXISTS ' : '';

  const lines = [];
  lines.push(`CREATE ${orReplace}CORTEX SEARCH SERVICE ${ifNotExists}${name}`);
  lines.push(`  ON ${searchColumn}`);
  if (attributes.length > 0) {
    lines.push(`  ATTRIBUTES ${attributes.join(', ')}`);
  }
  lines.push(`  WAREHOUSE = ${warehouse}`);
  lines.push(`  TARGET_LAG = ${literal(targetLag)}`);
  if (spec.embeddingModel && String(spec.embeddingModel).trim()) {
    lines.push(`  EMBEDDING_MODEL = ${literal(String(spec.embeddingModel).trim())}`);
  }
  if (spec.comment && String(spec.comment).trim()) {
    lines.push(`  COMMENT = ${literal(String(spec.comment).trim())}`);
  }
  lines.push(`AS (\n${query}\n)`);

  return lines.join('\n');
}

/**
 * Build a CREATE SEMANTIC VIEW statement.
 * spec: {
 *   name, database?, schema?, orReplace?, ifNotExists?, comment?,
 *   tables: [{ alias, table, primaryKey?[], synonyms?[], comment? }],
 *   relationships: [{ name?, fromAlias, fromColumns[], toAlias, toColumns[] }],
 *   facts: [{ alias, name, expr, comment? }],
 *   dimensions: [{ alias, name, expr, synonyms?[], comment? }],
 *   metrics: [{ alias, name, expr, comment? }]
 * }
 */
function buildCreateSemanticViewSql(spec, defaults = {}) {
  const database = spec.database || defaults.database;
  const schema = spec.schema || defaults.schema;
  const name = qualifyWithDefaults(spec.name, database, schema);

  const tables = spec.tables || [];
  if (tables.length === 0) {
    throw new Error('At least one logical table is required.');
  }

  // TABLES ( ... )
  const tableDefs = tables.map(t => {
    const alias = ident(t.alias, 'table alias');
    const tableRef = qualified(t.table, 'table');
    let def = `    ${alias} AS ${tableRef}`;
    const pk = (t.primaryKey || []).map(c => ident(c, 'primary key column'));
    if (pk.length > 0) def += `\n      PRIMARY KEY (${pk.join(', ')})`;
    const syn = synonymsClause(t.synonyms);
    if (syn) def += `\n      ${syn}`;
    if (t.comment && String(t.comment).trim()) def += `\n      COMMENT = ${literal(String(t.comment).trim())}`;
    return def;
  });

  const clauses = [];
  clauses.push(`  TABLES (\n${tableDefs.join(',\n')}\n  )`);

  // RELATIONSHIPS ( ... )
  const relationships = (spec.relationships || []).filter(r => r && r.fromAlias && r.toAlias);
  if (relationships.length > 0) {
    const relDefs = relationships.map(r => {
      const fromAlias = ident(r.fromAlias, 'relationship from-table');
      const toAlias = ident(r.toAlias, 'relationship to-table');
      const fromCols = (r.fromColumns || []).map(c => ident(c, 'relationship column'));
      const toCols = (r.toColumns || []).map(c => ident(c, 'relationship column'));
      if (fromCols.length === 0 || toCols.length === 0) {
        throw new Error('Each relationship needs at least one column on both sides.');
      }
      const prefix = r.name && String(r.name).trim() ? `${ident(r.name, 'relationship name')} AS ` : '';
      return `    ${prefix}${fromAlias} (${fromCols.join(', ')}) REFERENCES ${toAlias} (${toCols.join(', ')})`;
    });
    clauses.push(`  RELATIONSHIPS (\n${relDefs.join(',\n')}\n  )`);
  }

  // FACTS ( ... )
  const facts = (spec.facts || []).filter(f => f && f.alias && f.name && f.expr);
  if (facts.length > 0) {
    const factDefs = facts.map(f => {
      const alias = ident(f.alias, 'fact table');
      const nm = ident(f.name, 'fact name');
      let def = `    ${alias}.${nm} AS ${String(f.expr).trim()}`;
      if (f.comment && String(f.comment).trim()) def += ` COMMENT = ${literal(String(f.comment).trim())}`;
      return def;
    });
    clauses.push(`  FACTS (\n${factDefs.join(',\n')}\n  )`);
  }

  // DIMENSIONS ( ... )
  const dimensions = (spec.dimensions || []).filter(d => d && d.alias && d.name && d.expr);
  if (dimensions.length > 0) {
    const dimDefs = dimensions.map(d => {
      const alias = ident(d.alias, 'dimension table');
      const nm = ident(d.name, 'dimension name');
      let def = `    ${alias}.${nm} AS ${String(d.expr).trim()}`;
      const syn = synonymsClause(d.synonyms);
      if (syn) def += ` ${syn}`;
      if (d.comment && String(d.comment).trim()) def += ` COMMENT = ${literal(String(d.comment).trim())}`;
      return def;
    });
    clauses.push(`  DIMENSIONS (\n${dimDefs.join(',\n')}\n  )`);
  }

  // METRICS ( ... )
  const metrics = (spec.metrics || []).filter(m => m && m.alias && m.name && m.expr);
  if (metrics.length > 0) {
    const metricDefs = metrics.map(m => {
      const alias = ident(m.alias, 'metric table');
      const nm = ident(m.name, 'metric name');
      let def = `    ${alias}.${nm} AS ${String(m.expr).trim()}`;
      if (m.comment && String(m.comment).trim()) def += ` COMMENT = ${literal(String(m.comment).trim())}`;
      return def;
    });
    clauses.push(`  METRICS (\n${metricDefs.join(',\n')}\n  )`);
  }

  const orReplace = spec.orReplace ? 'OR REPLACE ' : '';
  const ifNotExists = !spec.orReplace && spec.ifNotExists ? 'IF NOT EXISTS ' : '';

  let sql = `CREATE ${orReplace}SEMANTIC VIEW ${ifNotExists}${name}\n${clauses.join('\n')}`;
  if (spec.comment && String(spec.comment).trim()) {
    sql += `\n  COMMENT = ${literal(String(spec.comment).trim())}`;
  }
  return sql;
}

module.exports = {
  ident,
  qualified,
  qualifyWithDefaults,
  literal,
  buildCreateSearchServiceSql,
  buildCreateSemanticViewSql,
};
