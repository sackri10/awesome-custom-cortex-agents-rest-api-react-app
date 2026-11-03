/**
 * ScopeBar
 * Pick the database and schema the app works in, instead of fixing them in the backend .env.
 * The lists come from Snowflake and show only what the active role (see RunAsBar) can see.
 * Shown on every chat screen, including the error and empty ones, so a choice the active role
 * cannot use can always be changed.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { SCOPE_TEXT } from '../../constants/textConstants';
import { RequestScope } from '../../services/requestScope';
import { fetchSnowflakeContext, listDatabases, listSchemas } from '../../services/snowflakeObjectsApi';

interface ScopeBarProps {
  /** The scope chosen in the UI, or null when only the backend default (if any) applies */
  scope: RequestScope | null;
  onChange: (scope: RequestScope) => void;
  /** Changes when the active role changes, because each role sees different databases */
  roleKey: string;
  /** Block changes while an answer is streaming */
  disabled?: boolean;
}

const withCurrent = (list: string[], current: string): string[] =>
  current && !list.includes(current) ? [...list, current] : list;

export const ScopeBar: React.FC<ScopeBarProps> = ({ scope, onChange, roleKey, disabled }) => {
  const [database, setDatabase] = useState(scope ? scope.database : '');
  const [schema, setSchema] = useState(scope ? scope.schema : '');
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [usingDefault, setUsingDefault] = useState(false);

  // Follow the chosen scope when it is changed from elsewhere
  useEffect(() => {
    if (scope) { setDatabase(scope.database); setSchema(scope.schema); setUsingDefault(false); }
  }, [scope]);

  // Nothing chosen yet: show the backend default, if it has one
  useEffect(() => {
    if (scope) return;
    let cancelled = false;
    fetchSnowflakeContext()
      .then(ctx => {
        if (cancelled || !ctx.defaultDatabase) return;
        setDatabase(ctx.defaultDatabase);
        setSchema(ctx.defaultSchema || '');
        setUsingDefault(true);
      })
      .catch(() => { /* the screens report a backend problem */ });
    return () => { cancelled = true; };
  }, [scope]);

  // Databases visible to the active role
  useEffect(() => {
    let cancelled = false;
    setDatabases(null);
    setError(null);
    listDatabases()
      .then(list => { if (!cancelled) setDatabases(list); })
      .catch((err: any) => { if (!cancelled) { setDatabases([]); setError(err?.fullMessage || err?.message || 'Failed to list databases'); } });
    return () => { cancelled = true; };
  }, [roleKey, reloadTick]);

  // Schemas of the chosen database
  const autoPicked = useRef('');
  useEffect(() => {
    if (!database) { setSchemas(null); return; }
    let cancelled = false;
    setSchemas(null);
    listSchemas(database)
      .then(list => {
        if (cancelled) return;
        setSchemas(list);
        // A database with a single schema needs no second click
        if (!schema && list.length === 1 && autoPicked.current !== `${database}.${list[0]}`) {
          autoPicked.current = `${database}.${list[0]}`;
          setSchema(list[0]);
          onChange({ database, schema: list[0] });
        }
      })
      .catch(() => { if (!cancelled) setSchemas([]); });
    return () => { cancelled = true; };
    // schema and onChange are deliberately left out: this reloads the list only when the database or role changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, roleKey, reloadTick]);

  const handleDatabase = (value: string) => {
    setDatabase(value);
    setSchema('');
    setUsingDefault(false);
  };

  const handleSchema = (value: string) => {
    setSchema(value);
    setUsingDefault(false);
    if (database && value) onChange({ database, schema: value });
  };

  const databaseOptions = withCurrent(databases || [], database);
  const schemaOptions = withCurrent(schemas || [], schema);
  const databaseHidden = !!database && databases !== null && !databases.includes(database);
  const schemaHidden = !!schema && schemas !== null && !schemas.includes(schema);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
        <TextField
          select
          size="small"
          label={SCOPE_TEXT.DATABASE}
          value={database}
          onChange={e => handleDatabase(String(e.target.value))}
          disabled={disabled || databases === null}
          error={databaseHidden}
          helperText={databaseHidden ? SCOPE_TEXT.NOT_VISIBLE : (usingDefault ? SCOPE_TEXT.DEFAULT_NOTE : ' ')}
          sx={{ minWidth: 220 }}
        >
          {databaseOptions.length === 0 && <MenuItem value="" disabled>{databases === null ? SCOPE_TEXT.LOADING : SCOPE_TEXT.NONE}</MenuItem>}
          {databaseOptions.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
        </TextField>

        <TextField
          select
          size="small"
          label={SCOPE_TEXT.SCHEMA}
          value={schema}
          onChange={e => handleSchema(String(e.target.value))}
          disabled={disabled || !database || schemas === null}
          error={schemaHidden}
          helperText={schemaHidden ? SCOPE_TEXT.NOT_VISIBLE : ' '}
          sx={{ minWidth: 220 }}
        >
          {schemaOptions.map(sc => <MenuItem key={sc} value={sc}>{sc}</MenuItem>)}
        </TextField>

        <Tooltip title={SCOPE_TEXT.REFRESH} arrow>
          <span>
            <IconButton size="small" onClick={() => setReloadTick(t => t + 1)} disabled={databases === null} aria-label={SCOPE_TEXT.REFRESH} sx={{ mt: 0.5 }}>
              {databases === null ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 220, pt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">{SCOPE_TEXT.CAPTION}</Typography>
          {error && (
            <Typography variant="caption" color="error" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>{error}</Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
};
