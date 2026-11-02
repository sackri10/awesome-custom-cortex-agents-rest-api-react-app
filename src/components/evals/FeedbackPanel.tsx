/**
 * FeedbackPanel
 * Reads CORTEX_AGENT_FEEDBACK observability events for one agent and shows
 * totals, positive rate, category counts, and the individual entries.
 *
 * Loads on demand only: the observability functions scan an event table and
 * use warehouse time, so we don't query on every page view.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import {
  ThumbUpAlt as ThumbUpIcon,
  ThumbDownAlt as ThumbDownIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import { EVALS_TEXT } from '../../constants/textConstants';
import { fetchAgentFeedback, FeedbackEvent } from '../../services/snowflakeEvalsApi';
import { BarRow, ErrorAlert, MONO_FONT, Panel, StatTile, formatTimestamp } from './shared';

const daysAgo = (days: number): string => {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
};

export const FeedbackPanel: React.FC<{ agentName: string }> = ({ agentName }) => {
  const [since, setSince] = useState(daysAgo(7));
  const [rows, setRows] = useState<FeedbackEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new agent means the previous results no longer apply
  useEffect(() => {
    setRows(null);
    setError(null);
  }, [agentName]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAgentFeedback(agentName, { since: since || undefined }));
    } catch (err: any) {
      setError(err?.fullMessage || err?.message || 'Failed to load feedback');
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    if (!rows) return null;
    const rated = rows.filter(r => r.positive !== null);
    const positive = rated.filter(r => r.positive).length;
    const counts = new Map<string, number>();
    rows.forEach(r => r.categories.forEach(c => counts.set(c, (counts.get(c) || 0) + 1)));
    const categories = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return {
      total: rows.length,
      positive,
      negative: rated.length - positive,
      positiveRate: rated.length ? positive / rated.length : null,
      categories
    };
  }, [rows]);

  const downloadJson = () => {
    if (!rows) return;
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agentName}_feedback_since_${since || 'all'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack spacing={2.5}>
      <Panel>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField
            type="date"
            label={EVALS_TEXT.SINCE_LABEL}
            value={since}
            onChange={e => setSince(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <Button
            variant="contained"
            onClick={load}
            disabled={loading || !agentName}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {EVALS_TEXT.LOAD_FEEDBACK}
          </Button>
          {rows && rows.length > 0 && (
            <Button startIcon={<DownloadIcon />} onClick={downloadJson} color="inherit" size="small">
              JSON
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {EVALS_TEXT.FEEDBACK_NOTE}
        </Typography>
      </Panel>

      <ErrorAlert message={error} />

      {stats && (
        <>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
            <StatTile label={EVALS_TEXT.FEEDBACK_TOTAL} value={String(stats.total)} />
            <StatTile
              label={EVALS_TEXT.FEEDBACK_POSITIVE_RATE}
              value={stats.positiveRate === null ? '—' : `${Math.round(stats.positiveRate * 100)}%`}
              caption={`${stats.positive} of ${stats.positive + stats.negative}`}
            />
            <StatTile label={EVALS_TEXT.FEEDBACK_NEGATIVE} value={String(stats.negative)} />
          </Stack>

          {stats.categories.length > 0 && (
            <Panel title={EVALS_TEXT.FEEDBACK_CATEGORIES}>
              {stats.categories.map(([category, count]) => (
                <BarRow
                  key={category}
                  label={category}
                  value={count}
                  max={stats.categories[0][1]}
                  valueLabel={String(count)}
                  tooltip={`${category}: ${count} of ${stats.total} responses`}
                />
              ))}
            </Panel>
          )}

          <Panel title={EVALS_TEXT.FEEDBACK_LIST}>
            {rows && rows.length === 0 ? (
              <Typography color="text.secondary">{EVALS_TEXT.FEEDBACK_EMPTY}</Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 520 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Rating</TableCell>
                      <TableCell>Categories</TableCell>
                      <TableCell>Comment</TableCell>
                      <TableCell>User</TableCell>
                      <TableCell>Request</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows!.map((r, i) => (
                      <TableRow key={`${r.timestamp}-${i}`} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTimestamp(r.timestamp)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {r.positive === null ? '—' : (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                              {r.positive
                                ? <ThumbUpIcon sx={{ fontSize: 16 }} color="success" />
                                : <ThumbDownIcon sx={{ fontSize: 16 }} color="error" />}
                              <Typography variant="body2">{r.positive ? 'Positive' : 'Negative'}</Typography>
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            {r.categories.map(c => <Chip key={c} label={c} size="small" variant="outlined" />)}
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ minWidth: 200 }}>{r.feedback_message || ''}</TableCell>
                        <TableCell>{r.user || ''}</TableCell>
                        <TableCell sx={{ fontFamily: MONO_FONT, fontSize: '0.75rem' }}>
                          {r.request_id || EVALS_TEXT.AGENT_LEVEL}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Panel>
        </>
      )}
    </Stack>
  );
};
