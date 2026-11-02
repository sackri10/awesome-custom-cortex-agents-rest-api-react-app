/**
 * Small building blocks shared by the evals & feedback panels.
 */

import React from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Tooltip,
  Typography,
  alpha
} from '@mui/material';
import { EVALS_TEXT } from '../../constants/textConstants';

export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

/** Scores below this are treated as failures, matching the doc's "weak answers" query. */
export const WEAK_SCORE = 0.7;

export const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

export const formatScore = (score: number | null | undefined): string =>
  typeof score === 'number' ? score.toFixed(2) : '—';

export const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};

export const ErrorAlert: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <Alert severity="error">
      <AlertTitle>{EVALS_TEXT.LOAD_ERROR_TITLE}</AlertTitle>
      <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>
        {message}
      </Typography>
    </Alert>
  ) : null;

export const Panel: React.FC<{ title?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    {(title || action) && (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        {title && <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>}
        {action}
      </Box>
    )}
    {children}
  </Paper>
);

export const StatTile: React.FC<{ label: string; value: string; caption?: string }> = ({ label, value, caption }) => (
  <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, flex: 1, minWidth: 140 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h4" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    {caption && <Typography variant="caption" color="text.secondary">{caption}</Typography>}
  </Paper>
);

/**
 * One labelled horizontal bar: single hue for magnitude, value in text ink,
 * full-row hover target with a tooltip.
 */
export const BarRow: React.FC<{
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  tooltip: string;
  marker?: number;
}> = ({ label, value, max, valueLabel, tooltip, marker }) => {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <Tooltip title={tooltip} arrow placement="top" followCursor>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 56px', sm: 'minmax(120px, 220px) 1fr 56px' },
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 0.5,
          py: 0.75,
          px: 0.5,
          borderRadius: 1,
          '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }
        }}
      >
        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', gridColumn: { xs: '1 / 2', sm: 'auto' } }}>
          {label}
        </Typography>
        <Box sx={{ position: 'relative', height: 10, gridColumn: { xs: '1 / 3', sm: 'auto' }, gridRow: { xs: 2, sm: 'auto' } }}>
          <Box sx={{ position: 'absolute', inset: 0, borderRadius: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }} />
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              bgcolor: 'primary.main',
              borderRadius: '0 4px 4px 0'
            }}
          />
          {marker !== undefined && max > 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: -3,
                bottom: -3,
                left: `${(marker / max) * 100}%`,
                width: '1px',
                bgcolor: 'text.secondary'
              }}
            />
          )}
        </Box>
        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {valueLabel}
        </Typography>
      </Box>
    </Tooltip>
  );
};

export const JsonDialog: React.FC<{
  open: boolean;
  title: string;
  loading?: boolean;
  error?: string | null;
  data: unknown;
  emptyText?: string;
  onClose: () => void;
}> = ({ open, title, loading, error, data, emptyText, onClose }) => {
  const isEmpty = Array.isArray(data) ? data.length === 0 : data === null || data === undefined;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : error ? (
          <ErrorAlert message={error} />
        ) : isEmpty ? (
          <Typography color="text.secondary">{emptyText || '—'}</Typography>
        ) : (
          <Typography
            component="pre"
            sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: MONO_FONT, fontSize: '0.8rem' }}
          >
            {toText(data)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{EVALS_TEXT.CLOSE}</Button>
      </DialogActions>
    </Dialog>
  );
};
