/**
 * CreateSemanticViewForm
 *
 * Guided, multi-section builder for a semantic view (used as a Cortex Analyst
 * tool). Rendered inside a dialog from the Create Agent page. Users define
 * logical tables, relationships, dimensions, metrics, and (optionally) facts;
 * the backend assembles and runs the CREATE SEMANTIC VIEW DDL.
 *
 * Column/expression fields are free text (semantic expressions are SQL); table
 * names offer autocomplete from schema introspection.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Stack,
  TextField,
  Autocomplete,
  MenuItem,
  IconButton,
  Button,
  Alert,
  CircularProgress,
  Typography,
  Paper,
  FormControlLabel,
  Checkbox,
  Box,
  Tooltip,
  Divider,
} from '@mui/material';
import { Add as AddIcon, DeleteOutline as DeleteIcon } from '@mui/icons-material';
import {
  SnowflakeContext,
  TableObject,
  listTables,
  createSemanticView,
  SemanticTableSpec,
  SemanticRelationshipSpec,
  SemanticExprSpec,
} from '../../services/snowflakeObjectsApi';

interface CreateSemanticViewFormProps {
  context: SnowflakeContext | null;
  onCreated: (fqn: string) => void;
  onCancel: () => void;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

// Local row shapes use comma-separated strings for column lists (parsed on submit).
interface TableRow { alias: string; table: string; primaryKey: string; synonyms: string; comment: string; }
interface RelRow { name: string; fromAlias: string; fromColumns: string; toAlias: string; toColumns: string; }
interface ExprRow { alias: string; name: string; expr: string; synonyms: string; comment: string; }

const emptyTable = (): TableRow => ({ alias: '', table: '', primaryKey: '', synonyms: '', comment: '' });
const emptyRel = (): RelRow => ({ name: '', fromAlias: '', fromColumns: '', toAlias: '', toColumns: '' });
const emptyExpr = (): ExprRow => ({ alias: '', name: '', expr: '', synonyms: '', comment: '' });

const splitList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

const CreateSemanticViewForm: React.FC<CreateSemanticViewFormProps> = ({ context, onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [database, setDatabase] = useState(context?.database || '');
  const [schema, setSchema] = useState(context?.schema || '');
  const [comment, setComment] = useState('');
  const [orReplace, setOrReplace] = useState(false);

  const [tables, setTables] = useState<TableRow[]>([emptyTable()]);
  const [relationships, setRelationships] = useState<RelRow[]>([]);
  const [dimensions, setDimensions] = useState<ExprRow[]>([emptyExpr()]);
  const [metrics, setMetrics] = useState<ExprRow[]>([emptyExpr()]);
  const [facts, setFacts] = useState<ExprRow[]>([]);

  const [tableOptions, setTableOptions] = useState<TableObject[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!database || !schema) return;
    let cancelled = false;
    listTables(database, schema)
      .then((t) => { if (!cancelled) setTableOptions(t); })
      .catch(() => { if (!cancelled) setTableOptions([]); });
    return () => { cancelled = true; };
  }, [database, schema]);

  // Aliases that have been defined (used in relationship / expression selectors)
  const aliases = tables.map((t) => t.alias.trim()).filter(Boolean);

  // Generic helpers to update a row within an array
  const updateRow = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) => {
    setter((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const removeRow = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number) => {
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!name.trim() || !IDENT_RE.test(name.trim())) {
      setError('Enter a valid semantic view name (letters, numbers, underscores; start with a letter/underscore).');
      return;
    }
    const tableSpecs: SemanticTableSpec[] = tables
      .filter((t) => t.alias.trim() && t.table.trim())
      .map((t) => ({
        alias: t.alias.trim(),
        table: t.table.trim(),
        primaryKey: splitList(t.primaryKey),
        synonyms: splitList(t.synonyms),
        comment: t.comment.trim() || undefined,
      }));
    if (tableSpecs.length === 0) {
      setError('Add at least one logical table (alias + physical table).');
      return;
    }

    const relSpecs: SemanticRelationshipSpec[] = relationships
      .filter((r) => r.fromAlias.trim() && r.toAlias.trim() && r.fromColumns.trim() && r.toColumns.trim())
      .map((r) => ({
        name: r.name.trim() || undefined,
        fromAlias: r.fromAlias.trim(),
        fromColumns: splitList(r.fromColumns),
        toAlias: r.toAlias.trim(),
        toColumns: splitList(r.toColumns),
      }));

    const toExprSpecs = (rows: ExprRow[]): SemanticExprSpec[] => rows
      .filter((d) => d.alias.trim() && d.name.trim() && d.expr.trim())
      .map((d) => ({
        alias: d.alias.trim(),
        name: d.name.trim(),
        expr: d.expr.trim(),
        synonyms: splitList(d.synonyms),
        comment: d.comment.trim() || undefined,
      }));

    setSubmitting(true);
    try {
      await createSemanticView({
        name: name.trim(),
        database: database.trim() || undefined,
        schema: schema.trim() || undefined,
        orReplace,
        comment: comment.trim() || undefined,
        tables: tableSpecs,
        relationships: relSpecs,
        dimensions: toExprSpecs(dimensions),
        metrics: toExprSpecs(metrics),
        facts: toExprSpecs(facts),
      });
      const db = (database.trim() || context?.database || '').toUpperCase();
      const sc = (schema.trim() || context?.schema || '').toUpperCase();
      onCreated(`${db}.${sc}.${name.trim().toUpperCase()}`);
    } catch (err) {
      setError((err as any).fullMessage || (err instanceof Error ? err.message : 'Failed to create semantic view'));
    } finally {
      setSubmitting(false);
    }
  }, [name, database, schema, orReplace, comment, tables, relationships, dimensions, metrics, facts, context, onCreated]);

  const nameError = name && !IDENT_RE.test(name.trim());

  const sectionSx = { p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' } as const;

  // Alias selector reused by relationships/dimensions/metrics/facts
  const aliasSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={submitting} sx={{ minWidth: 130 }}>
      {aliases.length === 0 && <MenuItem value="" disabled>Define a table first</MenuItem>}
      {aliases.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
    </TextField>
  );

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {error && (
        <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Basics */}
      <TextField
        label="Semantic view name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        fullWidth
        disabled={submitting}
        error={!!nameError}
        helperText={nameError ? 'Invalid identifier' : 'e.g. SALES_SV'}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="Database" value={database} onChange={(e) => setDatabase(e.target.value)} fullWidth disabled={submitting} />
        <TextField label="Schema" value={schema} onChange={(e) => setSchema(e.target.value)} fullWidth disabled={submitting} />
      </Stack>
      <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} fullWidth disabled={submitting} />

      {/* Tables */}
      <Typography variant="subtitle1" fontWeight={600}>Logical tables</Typography>
      <Stack spacing={2}>
        {tables.map((t, i) => (
          <Paper key={i} elevation={0} sx={sectionSx}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  label="Alias"
                  value={t.alias}
                  onChange={(e) => updateRow(setTables, i, { alias: e.target.value })}
                  disabled={submitting}
                  sx={{ minWidth: 120 }}
                  helperText="Logical name"
                />
                <Autocomplete
                  sx={{ flex: 1 }}
                  freeSolo
                  options={tableOptions.map((o) => o.name)}
                  value={t.table}
                  onChange={(_, v) => updateRow(setTables, i, { table: v || '' })}
                  onInputChange={(_, v, reason) => { if (reason === 'input') updateRow(setTables, i, { table: v }); }}
                  disabled={submitting}
                  renderInput={(params) => <TextField {...params} label="Physical table" helperText="Name or DB.SCHEMA.TABLE" />}
                />
                <Tooltip title="Remove table" arrow>
                  <span>
                    <IconButton onClick={() => removeRow(setTables, i)} disabled={submitting || tables.length === 1}><DeleteIcon /></IconButton>
                  </span>
                </Tooltip>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField label="Primary key column(s)" value={t.primaryKey} onChange={(e) => updateRow(setTables, i, { primaryKey: e.target.value })} disabled={submitting} fullWidth helperText="Comma-separated" />
                <TextField label="Synonyms" value={t.synonyms} onChange={(e) => updateRow(setTables, i, { synonyms: e.target.value })} disabled={submitting} fullWidth helperText="Comma-separated" />
                <TextField label="Comment" value={t.comment} onChange={(e) => updateRow(setTables, i, { comment: e.target.value })} disabled={submitting} fullWidth />
              </Stack>
            </Stack>
          </Paper>
        ))}
        <Box><Button startIcon={<AddIcon />} onClick={() => setTables((p) => [...p, emptyTable()])} disabled={submitting} sx={{ textTransform: 'none' }}>Add table</Button></Box>
      </Stack>

      <Divider />

      {/* Relationships */}
      <Typography variant="subtitle1" fontWeight={600}>Relationships</Typography>
      <Stack spacing={2}>
        {relationships.map((r, i) => (
          <Paper key={i} elevation={0} sx={sectionSx}>
            <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              <TextField label="Name (optional)" value={r.name} onChange={(e) => updateRow(setRelationships, i, { name: e.target.value })} disabled={submitting} sx={{ minWidth: 140 }} />
              {aliasSelect(r.fromAlias, (v) => updateRow(setRelationships, i, { fromAlias: v }), 'From table')}
              <TextField label="From column(s)" value={r.fromColumns} onChange={(e) => updateRow(setRelationships, i, { fromColumns: e.target.value })} disabled={submitting} helperText="Comma-separated" />
              {aliasSelect(r.toAlias, (v) => updateRow(setRelationships, i, { toAlias: v }), 'To table')}
              <TextField label="To column(s)" value={r.toColumns} onChange={(e) => updateRow(setRelationships, i, { toColumns: e.target.value })} disabled={submitting} helperText="Comma-separated" />
              <Tooltip title="Remove relationship" arrow>
                <span><IconButton onClick={() => removeRow(setRelationships, i)} disabled={submitting}><DeleteIcon /></IconButton></span>
              </Tooltip>
            </Stack>
          </Paper>
        ))}
        <Box><Button startIcon={<AddIcon />} onClick={() => setRelationships((p) => [...p, emptyRel()])} disabled={submitting} sx={{ textTransform: 'none' }}>Add relationship</Button></Box>
      </Stack>

      <Divider />

      {/* Dimensions */}
      <Typography variant="subtitle1" fontWeight={600}>Dimensions</Typography>
      <Stack spacing={2}>
        {dimensions.map((d, i) => (
          <Paper key={i} elevation={0} sx={sectionSx}>
            <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              {aliasSelect(d.alias, (v) => updateRow(setDimensions, i, { alias: v }), 'Table')}
              <TextField label="Name" value={d.name} onChange={(e) => updateRow(setDimensions, i, { name: e.target.value })} disabled={submitting} sx={{ minWidth: 120 }} />
              <TextField label="Expression" value={d.expr} onChange={(e) => updateRow(setDimensions, i, { expr: e.target.value })} disabled={submitting} sx={{ flex: 1, minWidth: 160 }} helperText="e.g. orders.created_at" />
              <TextField label="Synonyms" value={d.synonyms} onChange={(e) => updateRow(setDimensions, i, { synonyms: e.target.value })} disabled={submitting} helperText="Comma-separated" />
              <Tooltip title="Remove dimension" arrow>
                <span><IconButton onClick={() => removeRow(setDimensions, i)} disabled={submitting || dimensions.length === 1}><DeleteIcon /></IconButton></span>
              </Tooltip>
            </Stack>
          </Paper>
        ))}
        <Box><Button startIcon={<AddIcon />} onClick={() => setDimensions((p) => [...p, emptyExpr()])} disabled={submitting} sx={{ textTransform: 'none' }}>Add dimension</Button></Box>
      </Stack>

      <Divider />

      {/* Metrics */}
      <Typography variant="subtitle1" fontWeight={600}>Metrics</Typography>
      <Stack spacing={2}>
        {metrics.map((m, i) => (
          <Paper key={i} elevation={0} sx={sectionSx}>
            <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              {aliasSelect(m.alias, (v) => updateRow(setMetrics, i, { alias: v }), 'Table')}
              <TextField label="Name" value={m.name} onChange={(e) => updateRow(setMetrics, i, { name: e.target.value })} disabled={submitting} sx={{ minWidth: 120 }} />
              <TextField label="Expression" value={m.expr} onChange={(e) => updateRow(setMetrics, i, { expr: e.target.value })} disabled={submitting} sx={{ flex: 1, minWidth: 160 }} helperText="e.g. SUM(orders.amount)" />
              <TextField label="Comment" value={m.comment} onChange={(e) => updateRow(setMetrics, i, { comment: e.target.value })} disabled={submitting} />
              <Tooltip title="Remove metric" arrow>
                <span><IconButton onClick={() => removeRow(setMetrics, i)} disabled={submitting || metrics.length === 1}><DeleteIcon /></IconButton></span>
              </Tooltip>
            </Stack>
          </Paper>
        ))}
        <Box><Button startIcon={<AddIcon />} onClick={() => setMetrics((p) => [...p, emptyExpr()])} disabled={submitting} sx={{ textTransform: 'none' }}>Add metric</Button></Box>
      </Stack>

      <Divider />

      {/* Facts (optional) */}
      <Typography variant="subtitle1" fontWeight={600}>Facts (optional)</Typography>
      <Stack spacing={2}>
        {facts.map((f, i) => (
          <Paper key={i} elevation={0} sx={sectionSx}>
            <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
              {aliasSelect(f.alias, (v) => updateRow(setFacts, i, { alias: v }), 'Table')}
              <TextField label="Name" value={f.name} onChange={(e) => updateRow(setFacts, i, { name: e.target.value })} disabled={submitting} sx={{ minWidth: 120 }} />
              <TextField label="Expression" value={f.expr} onChange={(e) => updateRow(setFacts, i, { expr: e.target.value })} disabled={submitting} sx={{ flex: 1, minWidth: 160 }} helperText="e.g. orders.amount" />
              <TextField label="Comment" value={f.comment} onChange={(e) => updateRow(setFacts, i, { comment: e.target.value })} disabled={submitting} />
              <Tooltip title="Remove fact" arrow>
                <span><IconButton onClick={() => removeRow(setFacts, i)} disabled={submitting}><DeleteIcon /></IconButton></span>
              </Tooltip>
            </Stack>
          </Paper>
        ))}
        <Box><Button startIcon={<AddIcon />} onClick={() => setFacts((p) => [...p, emptyExpr()])} disabled={submitting} sx={{ textTransform: 'none' }}>Add fact</Button></Box>
      </Stack>

      <FormControlLabel
        control={<Checkbox checked={orReplace} onChange={(e) => setOrReplace(e.target.checked)} disabled={submitting} />}
        label="Overwrite if a semantic view with this name already exists (OR REPLACE)"
      />

      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button onClick={onCancel} disabled={submitting} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ textTransform: 'none' }}
        >
          {submitting ? 'Creating...' : 'Create semantic view'}
        </Button>
      </Stack>
    </Stack>
  );
};

export default CreateSemanticViewForm;
