/**
 * AnalystEvalsPanel
 * Cortex Analyst evaluations target a semantic view, not an agent, so this tab has
 * its own picker. Views are listed from the database and schema the backend is bound to.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { EVALS_TEXT } from '../../constants/textConstants';
import { SchemaObject, listSemanticViews } from '../../services/snowflakeObjectsApi';
import { ErrorAlert } from './shared';
import { EvalRunsPanel } from './EvalRunsPanel';

export const AnalystEvalsPanel: React.FC = () => {
  const [views, setViews] = useState<SchemaObject[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSemanticViews()
      .then(list => {
        if (cancelled) return;
        setViews(list);
        setSelected(prev => prev || list[0]?.name || '');
      })
      .catch((err: any) => { if (!cancelled) setError(err?.fullMessage || err?.message || 'Failed to list semantic views'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 640 }}>
          {EVALS_TEXT.ANALYST_SUBTITLE}
        </Typography>
        <TextField
          select
          size="small"
          label={EVALS_TEXT.VIEW_LABEL}
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={loading || views.length === 0}
          sx={{ minWidth: 240 }}
        >
          {views.map(v => <MenuItem key={v.fqn} value={v.name}>{v.name}</MenuItem>)}
        </TextField>
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      <ErrorAlert message={error} />
      {!loading && !error && views.length === 0 && <Alert severity="info">{EVALS_TEXT.NO_VIEWS}</Alert>}

      {selected && <EvalRunsPanel kind="analyst" target={selected} />}
    </Stack>
  );
};
