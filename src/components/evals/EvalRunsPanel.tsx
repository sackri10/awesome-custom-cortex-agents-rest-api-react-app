/**
 * EvalRunsPanel
 * Start or track Cortex Agent eval runs (EXECUTE_AI_EVALUATION), check their
 * status, and read results (GET_AI_EVALUATION_DATA) as a per-metric summary and
 * a question × metric score grid, with per-record traces and run logs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  ChipProps,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  BookmarkAdd as TrackIcon,
  Sync as SyncIcon,
  BarChart as ResultsIcon,
  Delete as DeleteIcon,
  WarningAmber as WarningIcon,
  ReportProblemOutlined as LogsIcon
} from '@mui/icons-material';
import { EVALS_TEXT } from '../../constants/textConstants';
import {
  EvalRecord,
  EvalRun,
  EvalRunResults,
  EvalRunStatus,
  fetchEvalRecordTrace,
  fetchEvalRunLogs,
  fetchEvalRunResults,
  fetchEvalRunStatus,
  listEvalRuns,
  startEvalRun,
  untrackEvalRun
} from '../../services/snowflakeEvalsApi';
import { BarRow, ErrorAlert, JsonDialog, MONO_FONT, Panel, WEAK_SCORE, formatScore, formatTimestamp, toText } from './shared';

const STATUS_COLOR: Record<EvalRunStatus, ChipProps['color']> = {
  TRACKED: 'default',
  RUNNING: 'info',
  COMPLETED: 'success',
  PARTIALLY_COMPLETED: 'warning',
  FAILED: 'error',
  CANCELLED: 'default',
  UNKNOWN: 'default'
};

const configPathKey = (agent: string) => `evals.configPath.${agent}`;

const readStoredConfigPath = (agent: string): string => {
  try { return localStorage.getItem(configPathKey(agent)) || ''; } catch { return ''; }
};

const storeConfigPath = (agent: string, value: string) => {
  try { localStorage.setItem(configPathKey(agent), value); } catch { /* storage unavailable */ }
};

const defaultRunName = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `run_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};

/** Question text from an eval row; INPUT can be a plain string or a JSON payload. */
const questionOf = (r: EvalRecord): string => {
  const input = r.INPUT;
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const candidate = obj.query_text ?? obj.input_query ?? obj.question ?? obj.input;
    if (typeof candidate === 'string') return candidate;
  }
  return toText(input);
};

interface GridRow {
  recordId: string;
  question: string;
  output: string;
  groundTruth: string;
  scores: Record<string, number | null>;
  minScore: number | null;
}

const buildGrid = (records: EvalRecord[]): { metrics: string[]; rows: GridRow[] } => {
  const metrics = new Set<string>();
  const byRecord = new Map<string, GridRow>();
  records.forEach((r, i) => {
    const metric = String(r.METRIC_NAME ?? 'score');
    metrics.add(metric);
    const recordId = String(r.RECORD_ID ?? `row_${i}`);
    const row = byRecord.get(recordId) || {
      recordId,
      question: questionOf(r),
      output: toText(r.OUTPUT),
      groundTruth: toText(r.GROUND_TRUTH),
      scores: {},
      minScore: null
    };
    const score = typeof r.EVAL_AGG_SCORE === 'number' ? r.EVAL_AGG_SCORE : null;
    row.scores[metric] = score;
    if (score !== null) row.minScore = row.minScore === null ? score : Math.min(row.minScore, score);
    byRecord.set(recordId, row);
  });
  const rows = Array.from(byRecord.values()).sort((a, b) => (a.minScore ?? 1) - (b.minScore ?? 1));
  return { metrics: Array.from(metrics).sort(), rows };
};

export const EvalRunsPanel: React.FC<{ agentName: string }> = ({ agentName }) => {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [runName, setRunName] = useState(defaultRunName());
  const [configPath, setConfigPath] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState<'start' | 'track' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyRun, setBusyRun] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [results, setResults] = useState<EvalRunResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; emptyText?: string } | null>(null);
  const [dialogData, setDialogData] = useState<unknown>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!agentName) return;
    setRunsError(null);
    try {
      setRuns(await listEvalRuns(agentName));
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to load runs');
    }
  }, [agentName]);

  useEffect(() => {
    setSelectedRun(null);
    setResults(null);
    setResultsError(null);
    setConfigPath(readStoredConfigPath(agentName));
    loadRuns();
  }, [agentName, loadRuns]);

  const handleCreate = async (start: boolean) => {
    setSubmitting(start ? 'start' : 'track');
    setFormError(null);
    try {
      await startEvalRun(agentName, { runName: runName.trim(), configPath: configPath.trim(), label: label.trim() || undefined, start });
      storeConfigPath(agentName, configPath.trim());
      setRunName(defaultRunName());
      setLabel('');
      await loadRuns();
    } catch (err: any) {
      setFormError(err?.fullMessage || err?.message || 'Failed to start run');
    } finally {
      setSubmitting(null);
    }
  };

  const handleStatus = async (run: EvalRun) => {
    setBusyRun(run.runName);
    setRunsError(null);
    try {
      await fetchEvalRunStatus(agentName, run.runName);
      await loadRuns();
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to check status');
    } finally {
      setBusyRun(null);
    }
  };

  const handleResults = async (name: string) => {
    setSelectedRun(name);
    setResults(null);
    setResultsError(null);
    setResultsLoading(true);
    try {
      setResults(await fetchEvalRunResults(agentName, name));
    } catch (err: any) {
      setResultsError(err?.fullMessage || err?.message || 'Failed to load results');
    } finally {
      setResultsLoading(false);
    }
  };

  const handleUntrack = async (run: EvalRun) => {
    try {
      await untrackEvalRun(agentName, run.runName);
      if (selectedRun === run.runName) {
        setSelectedRun(null);
        setResults(null);
      }
      await loadRuns();
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to remove run');
    }
  };

  const openDialog = async (title: string, emptyText: string | undefined, loader: () => Promise<unknown>) => {
    setDialog({ title, emptyText });
    setDialogData(null);
    setDialogError(null);
    setDialogLoading(true);
    try {
      setDialogData(await loader());
    } catch (err: any) {
      setDialogError(err?.fullMessage || err?.message || 'Request failed');
    } finally {
      setDialogLoading(false);
    }
  };

  const grid = useMemo(() => (results ? buildGrid(results.records) : null), [results]);
  const visibleRows = useMemo(
    () => (grid ? (weakOnly ? grid.rows.filter(r => r.minScore !== null && r.minScore < WEAK_SCORE) : grid.rows) : []),
    [grid, weakOnly]
  );

  const runNameValid = /^[A-Za-z0-9_-]{1,128}$/.test(runName.trim());
  const configPathValid = /^@.+\.ya?ml$/i.test(configPath.trim());
  const formValid = runNameValid && configPathValid;

  // Say why the buttons are disabled instead of leaving them silently greyed out
  const configPathError = !configPath.trim()
    ? EVALS_TEXT.CONFIG_PATH_REQUIRED
    : (configPathValid ? '' : EVALS_TEXT.CONFIG_PATH_INVALID);
  const runNameError = runNameValid ? '' : EVALS_TEXT.RUN_NAME_INVALID;

  return (
    <Stack spacing={2.5}>
      <Panel title={EVALS_TEXT.NEW_RUN_TITLE}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={EVALS_TEXT.RUN_NAME_LABEL}
              helperText={runNameError || EVALS_TEXT.RUN_NAME_HELPER}
              error={!!runNameError}
              value={runName}
              onChange={e => setRunName(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label={EVALS_TEXT.RUN_LABEL_LABEL}
              value={label}
              onChange={e => setLabel(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label={EVALS_TEXT.CONFIG_PATH_LABEL}
            helperText={configPathError || EVALS_TEXT.CONFIG_PATH_HELPER}
            error={!!configPathError}
            value={configPath}
            onChange={e => setConfigPath(e.target.value)}
            size="small"
            fullWidth
            InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: '0.875rem' } }}
          />
          <ErrorAlert message={formError} />
          <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button
              onClick={() => handleCreate(false)}
              disabled={!formValid || submitting !== null}
              startIcon={submitting === 'track' ? <CircularProgress size={16} /> : <TrackIcon />}
              color="inherit"
            >
              {EVALS_TEXT.TRACK_RUN}
            </Button>
            <Button
              variant="contained"
              onClick={() => handleCreate(true)}
              disabled={!formValid || submitting !== null}
              startIcon={submitting === 'start' ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
            >
              {submitting === 'start' ? EVALS_TEXT.STARTING : EVALS_TEXT.START_RUN}
            </Button>
          </Stack>
        </Stack>
      </Panel>

      <Panel title={EVALS_TEXT.RUNS_TITLE}>
        <ErrorAlert message={runsError} />
        {runs.length === 0 ? (
          <Typography color="text.secondary">{EVALS_TEXT.RUNS_EMPTY}</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Run</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Config</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Started</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.runName} hover selected={selectedRun === run.runName}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: MONO_FONT }}>{run.runName}</Typography>
                      {run.label && <Typography variant="caption" color="text.secondary">{run.label}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={run.status} color={STATUS_COLOR[run.status] || 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, fontFamily: MONO_FONT, fontSize: '0.75rem', maxWidth: 260, wordBreak: 'break-all' }}>
                      {run.configPath}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, whiteSpace: 'nowrap' }}>
                      {formatTimestamp(run.startedAt)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={EVALS_TEXT.REFRESH_STATUS} arrow>
                        <span>
                          <IconButton size="small" onClick={() => handleStatus(run)} disabled={busyRun === run.runName}>
                            {busyRun === run.runName ? <CircularProgress size={16} /> : <SyncIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={EVALS_TEXT.VIEW_RESULTS} arrow>
                        <IconButton size="small" color="primary" onClick={() => handleResults(run.runName)}>
                          <ResultsIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={EVALS_TEXT.LOGS} arrow>
                        <IconButton
                          size="small"
                          onClick={() => openDialog(`${EVALS_TEXT.LOGS}: ${run.runName}`, EVALS_TEXT.LOGS_EMPTY, () => fetchEvalRunLogs(agentName, run.runName))}
                        >
                          <LogsIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={EVALS_TEXT.UNTRACK} arrow>
                        <IconButton size="small" onClick={() => handleUntrack(run)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Panel>

      {selectedRun && (
        <>
          {resultsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          )}
          <ErrorAlert message={resultsError} />

          {results && grid && (
            results.records.length === 0 ? (
              <Alert severity="info">{EVALS_TEXT.RESULTS_EMPTY}</Alert>
            ) : (
              <>
                <Panel title={`${EVALS_TEXT.METRICS_TITLE} · ${selectedRun}`}>
                  {results.summary.map(m => (
                    <BarRow
                      key={m.metric}
                      label={m.metric}
                      value={m.avgScore ?? 0}
                      max={1}
                      marker={WEAK_SCORE}
                      valueLabel={formatScore(m.avgScore)}
                      tooltip={`${m.metric}: avg ${formatScore(m.avgScore)}, min ${formatScore(m.minScore)} over ${m.records} records (line = ${WEAK_SCORE})`}
                    />
                  ))}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    {EVALS_TEXT.RERUN_HINT}
                  </Typography>
                </Panel>

                <Panel
                  title={EVALS_TEXT.RECORDS_TITLE}
                  action={
                    <FormControlLabel
                      control={<Switch checked={weakOnly} onChange={e => setWeakOnly(e.target.checked)} size="small" />}
                      label={<Typography variant="body2">{EVALS_TEXT.SHOW_WEAK_ONLY}</Typography>}
                    />
                  }
                >
                  <TableContainer sx={{ maxHeight: 600 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 240 }}>Question</TableCell>
                          {grid.metrics.map(m => (
                            <TableCell key={m} align="right" sx={{ whiteSpace: 'nowrap' }}>{m}</TableCell>
                          ))}
                          <TableCell align="right" />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {visibleRows.map(row => (
                          <TableRow key={row.recordId} hover>
                            <TableCell>
                              <Tooltip
                                arrow
                                placement="bottom-start"
                                title={
                                  <Box sx={{ whiteSpace: 'pre-wrap', maxWidth: 480 }}>
                                    <strong>Answer:</strong> {row.output.slice(0, 800) || '—'}
                                    {row.groundTruth && <><br /><br /><strong>Expected:</strong> {row.groundTruth.slice(0, 800)}</>}
                                  </Box>
                                }
                              >
                                <Typography variant="body2">{row.question}</Typography>
                              </Tooltip>
                            </TableCell>
                            {grid.metrics.map(m => {
                              const score = row.scores[m];
                              const weak = typeof score === 'number' && score < WEAK_SCORE;
                              return (
                                <TableCell key={m} align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                    {weak && (
                                      <Tooltip title={`Below ${WEAK_SCORE}`} arrow>
                                        <WarningIcon sx={{ fontSize: 16 }} color="warning" aria-label={`Below ${WEAK_SCORE}`} />
                                      </Tooltip>
                                    )}
                                    <Typography variant="body2" sx={{ fontWeight: weak ? 600 : 400 }}>{formatScore(score)}</Typography>
                                  </Box>
                                </TableCell>
                              );
                            })}
                            <TableCell align="right">
                              {!row.recordId.startsWith('row_') && (
                                <Button
                                  size="small"
                                  onClick={() => openDialog(`${EVALS_TEXT.TRACE_TITLE}: ${row.recordId}`, undefined, () => fetchEvalRecordTrace(agentName, row.recordId))}
                                >
                                  {EVALS_TEXT.TRACE}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Panel>
              </>
            )
          )}
        </>
      )}

      <JsonDialog
        open={dialog !== null}
        title={dialog?.title || ''}
        emptyText={dialog?.emptyText}
        loading={dialogLoading}
        error={dialogError}
        data={dialogData}
        onClose={() => setDialog(null)}
      />
    </Stack>
  );
};
