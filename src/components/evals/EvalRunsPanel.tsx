/**
 * EvalRunsPanel
 * Start or track eval runs (EXECUTE_AI_EVALUATION), watch their status, and read the
 * results as a per-metric summary and a question × metric score grid.
 *
 * One panel serves two kinds of target:
 *  - 'agent'   : a Cortex Agent, scored on several metrics against a dataset table.
 *                Has per-record traces and run logs.
 *  - 'analyst' : a semantic view (Cortex Analyst), scored on sql_correctness against its
 *                verified queries. The config can be generated from the form.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
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
  Block as CancelIcon,
  WarningAmber as WarningIcon,
  ReportProblemOutlined as LogsIcon
} from '@mui/icons-material';
import { EVALS_TEXT } from '../../constants/textConstants';
import {
  EvalKind,
  EvalRun,
  EvalRunResults,
  FINISHED_STATUSES,
  IN_PROGRESS_STATUSES,
  cancelEvalRun,
  fetchEvalRecordTrace,
  fetchEvalRunLogs,
  fetchEvalRunResults,
  fetchEvalRunStatus,
  listEvalRuns,
  startEvalRun,
  untrackEvalRun
} from '../../services/snowflakeEvalsApi';
import { fetchSnowflakeContext } from '../../services/snowflakeObjectsApi';
import { BarRow, ErrorAlert, JsonDialog, MONO_FONT, Panel, StatTile, WEAK_SCORE, formatScore, formatTimestamp } from './shared';
import { GridRow, buildGrid, defaultRunName, statusColor } from './evalUtils';
import { RunComparison } from './RunComparison';

const METRIC_VERSIONS = ['v3', 'v2', 'v1'];
const POLL_MS = 30000;
const POLL_WINDOW_MS = 2 * 60 * 60 * 1000; // stop polling runs older than this

const readStored = (key: string): string => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};
const writeStored = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

interface EvalRunsPanelProps {
  kind: EvalKind;
  /** Agent name or semantic view name */
  target: string;
}

export const EvalRunsPanel: React.FC<EvalRunsPanelProps> = ({ kind, target }) => {
  const isAnalyst = kind === 'analyst';
  const configPathKey = `evals.configPath.${kind}.${target}`;
  const stageKey = 'evals.stage';

  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [statusErrors, setStatusErrors] = useState<{ run: string; details: string[] } | null>(null);

  const [runName, setRunName] = useState(defaultRunName());
  const [configPath, setConfigPath] = useState('');
  const [label, setLabel] = useState('');
  const [generate, setGenerate] = useState(isAnalyst);
  const [stage, setStage] = useState('');
  const [metricVersion, setMetricVersion] = useState('v3');
  const [questionsText, setQuestionsText] = useState('');
  const [submitting, setSubmitting] = useState<'start' | 'track' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyRun, setBusyRun] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState('');
  const [results, setResults] = useState<EvalRunResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);

  const [dialog, setDialog] = useState<{ title: string; emptyText?: string } | null>(null);
  const [dialogData, setDialogData] = useState<unknown>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!target) return;
    setRunsError(null);
    try {
      setRuns(await listEvalRuns(kind, target));
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to load runs');
    }
  }, [kind, target]);

  // Reset when the target changes
  useEffect(() => {
    setSelectedRun(null);
    setCompareWith('');
    setResults(null);
    setResultsError(null);
    setStatusErrors(null);
    setConfigPath(readStored(configPathKey));
    loadRuns();
  }, [configPathKey, loadRuns]);

  // Default stage for generated configs: last used, else the backend's suggestion
  useEffect(() => {
    if (!isAnalyst) return;
    const stored = readStored(stageKey);
    if (stored) { setStage(stored); return; }
    fetchSnowflakeContext()
      .then(ctx => setStage(prev => prev || ctx.evalConfigStage || ''))
      .catch(() => { /* the field just stays empty */ });
  }, [isAnalyst]);

  // Refresh runs that are still in progress
  const runsRef = useRef<EvalRun[]>([]);
  useEffect(() => { runsRef.current = runs; }, [runs]);
  useEffect(() => {
    const id = setInterval(async () => {
      const active = runsRef.current.filter(
        r => IN_PROGRESS_STATUSES.includes(r.status) && Date.now() - Date.parse(r.startedAt) < POLL_WINDOW_MS
      );
      if (active.length === 0) return;
      for (const r of active) {
        try { await fetchEvalRunStatus(kind, target, r.runName); } catch { /* shown when checked by hand */ }
      }
      loadRuns();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [kind, target, loadRuns]);

  const questions = useMemo(
    () => questionsText.split('\n').map(q => q.trim()).filter(Boolean),
    [questionsText]
  );

  const runNameValid = /^[A-Za-z0-9_-]{1,128}$/.test(runName.trim());
  const configPathValid = /^@.+\.ya?ml$/i.test(configPath.trim());
  const stageValid = /^@[A-Za-z0-9_$."\-/]+$/.test(stage.trim()) && !/\.ya?ml$/i.test(stage.trim());
  const useGenerate = isAnalyst && generate;

  const startValid = runNameValid && (useGenerate ? stageValid : configPathValid);
  const trackValid = runNameValid && configPathValid;

  // Say why the buttons are disabled instead of leaving them silently greyed out
  const configPathError = !configPath.trim()
    ? EVALS_TEXT.CONFIG_PATH_REQUIRED
    : (configPathValid ? '' : EVALS_TEXT.CONFIG_PATH_INVALID);
  const runNameError = runNameValid ? '' : EVALS_TEXT.RUN_NAME_INVALID;
  const stageError = stageValid ? '' : EVALS_TEXT.STAGE_INVALID;

  const handleCreate = async (start: boolean) => {
    setSubmitting(start ? 'start' : 'track');
    setFormError(null);
    try {
      if (useGenerate) {
        await startEvalRun(kind, target, {
          runName: runName.trim(),
          label: label.trim() || undefined,
          generate: { stage: stage.trim(), metricVersion, questions }
        });
        writeStored(stageKey, stage.trim());
      } else {
        await startEvalRun(kind, target, {
          runName: runName.trim(),
          configPath: configPath.trim(),
          label: label.trim() || undefined,
          start
        });
        writeStored(configPathKey, configPath.trim());
      }
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
      const status = await fetchEvalRunStatus(kind, target, run.runName);
      setStatusErrors(status.statusDetails.length ? { run: run.runName, details: status.statusDetails } : null);
      await loadRuns();
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to check status');
    } finally {
      setBusyRun(null);
    }
  };

  const handleCancel = async (run: EvalRun) => {
    if (!window.confirm(EVALS_TEXT.CANCEL_CONFIRM)) return;
    setBusyRun(run.runName);
    setRunsError(null);
    try {
      await cancelEvalRun(kind, target, run.runName);
      await loadRuns();
    } catch (err: any) {
      setRunsError(err?.fullMessage || err?.message || 'Failed to cancel run');
    } finally {
      setBusyRun(null);
    }
  };

  const handleResults = async (name: string) => {
    setSelectedRun(name);
    setCompareWith('');
    setResults(null);
    setResultsError(null);
    setResultsLoading(true);
    try {
      setResults(await fetchEvalRunResults(kind, target, name));
    } catch (err: any) {
      setResultsError(err?.fullMessage || err?.message || 'Failed to load results');
    } finally {
      setResultsLoading(false);
    }
  };

  const handleUntrack = async (run: EvalRun) => {
    try {
      await untrackEvalRun(kind, target, run.runName);
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

  const showRowDetails = (row: GridRow) => {
    setDialog({ title: `${EVALS_TEXT.DETAILS_TITLE}: ${row.question.slice(0, 80)}` });
    setDialogError(null);
    setDialogLoading(false);
    setDialogData({
      question: row.question,
      expected: row.groundTruth,
      response: row.output,
      error: row.error || undefined,
      metrics: Object.fromEntries(
        Object.entries(row.rawByMetric).map(([metric, r]) => [
          metric,
          { score: r.EVAL_AGG_SCORE, status: r.METRIC_STATUS, calls: r.METRIC_CALLS }
        ])
      )
    });
  };

  const grid = useMemo(() => (results ? buildGrid(results.records) : null), [results]);
  const visibleRows = useMemo(
    () => (grid ? (weakOnly ? grid.rows.filter(r => r.minScore !== null && r.minScore < WEAK_SCORE) : grid.rows) : []),
    [grid, weakOnly]
  );

  // Headline numbers for Analyst runs: how many queries, how accurate, how fast
  const analystStats = useMemo(() => {
    if (!isAnalyst || !grid || grid.rows.length === 0) return null;
    const scored = grid.rows.filter(r => r.minScore !== null);
    const avg = scored.length ? scored.reduce((sum, r) => sum + (r.minScore as number), 0) / scored.length : null;
    const timed = grid.rows.filter(r => r.durationMs !== null);
    const latency = timed.length ? timed.reduce((sum, r) => sum + (r.durationMs as number), 0) / timed.length : null;
    return {
      total: grid.rows.length,
      avg,
      weak: scored.filter(r => (r.minScore as number) < WEAK_SCORE).length,
      latency
    };
  }, [isAnalyst, grid]);

  const comparableRuns = runs.filter(r => r.runName !== selectedRun && FINISHED_STATUSES.includes(r.status));
  const expectedLabel = isAnalyst ? EVALS_TEXT.EXPECTED_SQL : 'Expected';
  const answerLabel = isAnalyst ? EVALS_TEXT.GENERATED : 'Answer';

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

          {isAnalyst && (
            <FormControlLabel
              control={<Switch checked={generate} onChange={e => setGenerate(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2">{EVALS_TEXT.GENERATE_LABEL}</Typography>
                  <Typography variant="caption" color="text.secondary">{EVALS_TEXT.GENERATE_HELP}</Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
            />
          )}

          {useGenerate ? (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={EVALS_TEXT.STAGE_LABEL}
                  helperText={stage.trim() ? (stageError || EVALS_TEXT.STAGE_HELPER) : EVALS_TEXT.STAGE_HELPER}
                  error={!!stage.trim() && !!stageError}
                  value={stage}
                  onChange={e => setStage(e.target.value)}
                  size="small"
                  sx={{ flex: 2 }}
                  InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: '0.875rem' } }}
                />
                <TextField
                  select
                  label={EVALS_TEXT.METRIC_VERSION_LABEL}
                  value={metricVersion}
                  onChange={e => setMetricVersion(e.target.value)}
                  size="small"
                  sx={{ flex: 1, minWidth: 140 }}
                >
                  {METRIC_VERSIONS.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ mt: '-8px !important' }}>
                {EVALS_TEXT.METRIC_VERSION_HELPER}
              </Typography>
              <TextField
                label={EVALS_TEXT.QUESTIONS_LABEL}
                helperText={EVALS_TEXT.QUESTIONS_HELPER}
                value={questionsText}
                onChange={e => setQuestionsText(e.target.value)}
                size="small"
                multiline
                minRows={2}
                fullWidth
              />
            </>
          ) : (
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
          )}

          <ErrorAlert message={formError} />
          <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {!useGenerate && (
              <Button
                onClick={() => handleCreate(false)}
                disabled={!trackValid || submitting !== null}
                startIcon={submitting === 'track' ? <CircularProgress size={16} /> : <TrackIcon />}
                color="inherit"
              >
                {EVALS_TEXT.TRACK_RUN}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={() => handleCreate(true)}
              disabled={!startValid || submitting !== null}
              startIcon={submitting === 'start' ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
            >
              {submitting === 'start' ? EVALS_TEXT.STARTING : EVALS_TEXT.START_RUN}
            </Button>
          </Stack>
        </Stack>
      </Panel>

      <Panel title={EVALS_TEXT.RUNS_TITLE}>
        <ErrorAlert message={runsError} />
        {statusErrors && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setStatusErrors(null)}>
            <Typography variant="subtitle2">{EVALS_TEXT.STATUS_ERRORS_TITLE} ({statusErrors.run})</Typography>
            <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit', fontSize: '0.85rem' }}>
              {statusErrors.details.join('\n')}
            </Typography>
          </Alert>
        )}
        {runs.length === 0 ? (
          <Typography color="text.secondary">{isAnalyst ? EVALS_TEXT.ANALYST_RUNS_EMPTY : EVALS_TEXT.RUNS_EMPTY}</Typography>
        ) : (
          <>
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
                  {runs.map(run => {
                    const inProgress = IN_PROGRESS_STATUSES.includes(run.status);
                    return (
                      <TableRow key={run.runName} hover selected={selectedRun === run.runName}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: MONO_FONT }}>{run.runName}</Typography>
                          {run.label && <Typography variant="caption" color="text.secondary">{run.label}</Typography>}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={run.status} color={statusColor(run.status)} variant="outlined" />
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
                          {inProgress && (
                            <Tooltip title={EVALS_TEXT.CANCEL_RUN} arrow>
                              <span>
                                <IconButton size="small" onClick={() => handleCancel(run)} disabled={busyRun === run.runName}>
                                  <CancelIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                          {!isAnalyst && (
                            <Tooltip title={EVALS_TEXT.LOGS} arrow>
                              <IconButton
                                size="small"
                                onClick={() => openDialog(`${EVALS_TEXT.LOGS}: ${run.runName}`, EVALS_TEXT.LOGS_EMPTY, () => fetchEvalRunLogs(target, run.runName))}
                              >
                                <LogsIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title={EVALS_TEXT.UNTRACK} arrow>
                            <IconButton size="small" onClick={() => handleUntrack(run)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              {EVALS_TEXT.POLL_NOTE}
            </Typography>
          </>
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
                {analystStats && (
                  <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
                    <StatTile
                      label={EVALS_TEXT.SQL_CORRECTNESS}
                      value={analystStats.avg === null ? '—' : `${Math.round(analystStats.avg * 100)}%`}
                      caption={EVALS_TEXT.SQL_CORRECTNESS_CAPTION}
                    />
                    <StatTile label={EVALS_TEXT.QUERIES_EVALUATED} value={String(analystStats.total)} />
                    <StatTile label={EVALS_TEXT.BELOW_THRESHOLD(WEAK_SCORE)} value={String(analystStats.weak)} />
                    <StatTile
                      label={EVALS_TEXT.AVG_LATENCY}
                      value={analystStats.latency === null ? '—' : `${(analystStats.latency / 1000).toFixed(1)}s`}
                    />
                  </Stack>
                )}

                <Panel
                  title={`${EVALS_TEXT.METRICS_TITLE} · ${selectedRun}`}
                  action={
                    comparableRuns.length > 0 ? (
                      <TextField
                        select
                        size="small"
                        label={EVALS_TEXT.COMPARE_LABEL}
                        value={compareWith}
                        onChange={e => setCompareWith(e.target.value)}
                        sx={{ minWidth: 220 }}
                      >
                        <MenuItem value="">{EVALS_TEXT.COMPARE_NONE}</MenuItem>
                        {comparableRuns.map(r => <MenuItem key={r.runName} value={r.runName}>{r.runName}</MenuItem>)}
                      </TextField>
                    ) : undefined
                  }
                >
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

                {compareWith && (
                  <RunComparison
                    kind={kind}
                    target={target}
                    baselineName={compareWith}
                    currentName={selectedRun}
                    current={results}
                  />
                )}

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
                                    <strong>{answerLabel}:</strong> {row.output.slice(0, 800) || '—'}
                                    {row.groundTruth && <><br /><br /><strong>{expectedLabel}:</strong> {row.groundTruth.slice(0, 800)}</>}
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
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              {isAnalyst ? (
                                <Button size="small" onClick={() => showRowDetails(row)}>{EVALS_TEXT.DETAILS}</Button>
                              ) : (
                                !row.recordId.startsWith('row_') && (
                                  <Button
                                    size="small"
                                    onClick={() => openDialog(`${EVALS_TEXT.TRACE_TITLE}: ${row.recordId}`, undefined, () => fetchEvalRecordTrace(target, row.recordId))}
                                  >
                                    {EVALS_TEXT.TRACE}
                                  </Button>
                                )
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
