/**
 * CreateSearchServiceForm
 *
 * Guided form to create a Cortex Search service. Rendered inside a dialog from
 * the Create Agent page. Introspects the chosen source table's columns to make
 * picking the search column / attributes easy, and generates the AS (SELECT ...)
 * source query for the user (with an optional raw override).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stack,
  TextField,
  MenuItem,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  Button,
  Alert,
  CircularProgress,
  Typography,
  Divider,
  Box,
} from '@mui/material';
import {
  SnowflakeContext,
  TableObject,
  ColumnObject,
  listTables,
  listColumns,
  createCortexSearchService,
} from '../../services/snowflakeObjectsApi';

interface CreateSearchServiceFormProps {
  context: SnowflakeContext | null;
  onCreated: (fqn: string) => void;
  onCancel: () => void;
}

const EMBEDDING_MODELS = [
  '(default)',
  'snowflake-arctic-embed-l-v2.0',
  'snowflake-arctic-embed-m-v1.5',
  'snowflake-arctic-embed-m',
  'voyage-multilingual-2',
];

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

const CreateSearchServiceForm: React.FC<CreateSearchServiceFormProps> = ({ context, onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [database, setDatabase] = useState(context?.database || '');
  const [schema, setSchema] = useState(context?.schema || '');
  const [warehouse, setWarehouse] = useState(context?.warehouse || '');
  const [sourceTable, setSourceTable] = useState<string>('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [searchColumn, setSearchColumn] = useState('');
  const [attributes, setAttributes] = useState<string[]>([]);
  const [targetLag, setTargetLag] = useState('1 hour');
  const [embeddingModel, setEmbeddingModel] = useState('(default)');
  const [comment, setComment] = useState('');
  const [orReplace, setOrReplace] = useState(false);
  const [rawQuery, setRawQuery] = useState('');

  const [tables, setTables] = useState<TableObject[]>([]);
  const [columns, setColumns] = useState<ColumnObject[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tables when database/schema change
  useEffect(() => {
    if (!database || !schema) return;
    let cancelled = false;
    setLoadingTables(true);
    listTables(database, schema)
      .then((t) => { if (!cancelled) setTables(t); })
      .catch(() => { if (!cancelled) setTables([]); })
      .finally(() => { if (!cancelled) setLoadingTables(false); });
    return () => { cancelled = true; };
  }, [database, schema]);

  // Load columns when a source table is chosen
  useEffect(() => {
    if (!sourceTable || !database || !schema) {
      setColumns([]);
      return;
    }
    let cancelled = false;
    setLoadingColumns(true);
    listColumns(sourceTable, database, schema)
      .then((cols) => {
        if (cancelled) return;
        setColumns(cols);
        // Default: include all columns
        setSelectedColumns(cols.map((c) => c.name));
      })
      .catch(() => { if (!cancelled) setColumns([]); })
      .finally(() => { if (!cancelled) setLoadingColumns(false); });
    return () => { cancelled = true; };
  }, [sourceTable, database, schema]);

  const generatedQuery = useMemo(() => {
    if (!sourceTable) return '';
    const cols = selectedColumns.length > 0 ? selectedColumns.join(', ') : '*';
    return `SELECT ${cols}\nFROM ${database}.${schema}.${sourceTable}`;
  }, [sourceTable, selectedColumns, database, schema]);

  const nameError = name && !IDENT_RE.test(name.trim());

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!name.trim() || !IDENT_RE.test(name.trim())) {
      setError('Enter a valid service name (letters, numbers, underscores; start with a letter/underscore).');
      return;
    }
    if (!warehouse.trim()) {
      setError('A warehouse is required to build the search service.');
      return;
    }
    const query = rawQuery.trim() || generatedQuery;
    if (!query) {
      setError('Choose a source table (or provide a raw source query).');
      return;
    }
    if (!searchColumn.trim()) {
      setError('Choose the search column (the text column to index).');
      return;
    }

    setSubmitting(true);
    try {
      await createCortexSearchService({
        name: name.trim(),
        database: database.trim() || undefined,
        schema: schema.trim() || undefined,
        orReplace,
        searchColumn: searchColumn.trim(),
        attributes,
        warehouse: warehouse.trim(),
        targetLag: targetLag.trim(),
        embeddingModel: embeddingModel === '(default)' ? undefined : embeddingModel,
        comment: comment.trim() || undefined,
        query,
      });
      const db = (database.trim() || context?.database || '').toUpperCase();
      const sc = (schema.trim() || context?.schema || '').toUpperCase();
      onCreated(`${db}.${sc}.${name.trim().toUpperCase()}`);
    } catch (err) {
      setError((err as any).fullMessage || (err instanceof Error ? err.message : 'Failed to create search service'));
    } finally {
      setSubmitting(false);
    }
  }, [
    name, warehouse, rawQuery, generatedQuery, searchColumn, database, schema,
    orReplace, attributes, targetLag, embeddingModel, comment, context, onCreated,
  ]);

  const columnNames = columns.map((c) => c.name);

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {error && (
        <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!context?.warehouseConfigured && (
        <Alert severity="warning">
          No default warehouse is configured on the server. Enter a warehouse name below — it must exist and you must have access to it.
        </Alert>
      )}

      <TextField
        label="Service name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        fullWidth
        disabled={submitting}
        error={!!nameError}
        helperText={nameError ? 'Invalid identifier' : 'e.g. DOCS_SEARCH'}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="Database" value={database} onChange={(e) => setDatabase(e.target.value)} fullWidth disabled={submitting} />
        <TextField label="Schema" value={schema} onChange={(e) => setSchema(e.target.value)} fullWidth disabled={submitting} />
      </Stack>

      <Autocomplete
        options={tables.map((t) => t.name)}
        value={sourceTable || null}
        onChange={(_, v) => setSourceTable(v || '')}
        freeSolo
        loading={loadingTables}
        disabled={submitting}
        onInputChange={(_, v, reason) => { if (reason === 'input') setSourceTable(v); }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Source table / view"
            helperText="The table or view containing the text to search."
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loadingTables ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      {sourceTable && (
        <>
          <Autocomplete
            multiple
            options={columnNames}
            value={selectedColumns}
            onChange={(_, v) => setSelectedColumns(v)}
            disabled={submitting || loadingColumns}
            renderInput={(params) => (
              <TextField {...params} label="Columns to include" helperText="Columns selected into the search service source query." />
            )}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Search column (ON)"
              value={searchColumn}
              onChange={(e) => setSearchColumn(e.target.value)}
              fullWidth
              required
              disabled={submitting}
              helperText="The text column to index for search."
            >
              {(selectedColumns.length ? selectedColumns : columnNames).map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <Autocomplete
              multiple
              sx={{ flex: 1 }}
              options={selectedColumns.length ? selectedColumns : columnNames}
              value={attributes}
              onChange={(_, v) => setAttributes(v)}
              disabled={submitting}
              renderInput={(params) => (
                <TextField {...params} label="Attributes (filterable)" helperText="Columns available for filtering." />
              )}
            />
          </Stack>
        </>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="Warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} fullWidth required disabled={submitting} />
        <TextField label="Target lag" value={targetLag} onChange={(e) => setTargetLag(e.target.value)} fullWidth disabled={submitting} helperText='e.g. "1 hour", "30 minutes"' />
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField select label="Embedding model" value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} fullWidth disabled={submitting}>
          {EMBEDDING_MODELS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
        </TextField>
        <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} fullWidth disabled={submitting} />
      </Stack>

      <Divider />
      <Box>
        <Typography variant="caption" color="text.secondary">Generated source query (edit below to override):</Typography>
        <TextField
          value={rawQuery || generatedQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          fullWidth
          multiline
          minRows={3}
          disabled={submitting}
          InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
        />
      </Box>

      <FormControlLabel
        control={<Checkbox checked={orReplace} onChange={(e) => setOrReplace(e.target.checked)} disabled={submitting} />}
        label="Overwrite if a service with this name already exists (OR REPLACE)"
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
          {submitting ? 'Creating...' : 'Create search service'}
        </Button>
      </Stack>
    </Stack>
  );
};

export default CreateSearchServiceForm;
