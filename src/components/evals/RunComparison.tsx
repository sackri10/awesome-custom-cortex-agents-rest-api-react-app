/**
 * RunComparison
 * Compares the open run with a baseline run: per-metric average change, and the
 * questions that crossed the pass line between the two (regressions and improvements).
 * Matching is by question text and metric, so it works for agent and Analyst runs.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { ArrowDownward as DownIcon, ArrowUpward as UpIcon } from '@mui/icons-material';
import { EVALS_TEXT } from '../../constants/textConstants';
import { EvalKind, EvalRecord, EvalRunResults, fetchEvalRunResults } from '../../services/snowflakeEvalsApi';
import { ErrorAlert, Panel, WEAK_SCORE, formatScore } from './shared';
import { questionOf } from './evalUtils';

interface RunComparisonProps {
  kind: EvalKind;
  target: string;
  baselineName: string;
  currentName: string;
  current: EvalRunResults;
}

const scoreMap = (records: EvalRecord[]): Map<string, { question: string; metric: string; score: number }> => {
  const map = new Map<string, { question: string; metric: string; score: number }>();
  records.forEach(r => {
    if (typeof r.EVAL_AGG_SCORE !== 'number') return;
    const question = questionOf(r);
    const metric = String(r.METRIC_NAME ?? 'score');
    map.set(`${question}\u0000${metric}`, { question, metric, score: r.EVAL_AGG_SCORE });
  });
  return map;
};

export const RunComparison: React.FC<RunComparisonProps> = ({ kind, target, baselineName, currentName, current }) => {
  const [baseline, setBaseline] = useState<EvalRunResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBaseline(null);
    setError(null);
    setLoading(true);
    fetchEvalRunResults(kind, target, baselineName)
      .then(r => { if (!cancelled) setBaseline(r); })
      .catch((err: any) => { if (!cancelled) setError(err?.fullMessage || err?.message || 'Failed to load baseline'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, target, baselineName]);

  const diff = useMemo(() => {
    if (!baseline) return null;
    const before = scoreMap(baseline.records);
    const after = scoreMap(current.records);
    const regressions: Array<{ question: string; metric: string; from: number; to: number }> = [];
    const improvements: Array<{ question: string; metric: string; from: number; to: number }> = [];
    let matched = 0;
    after.forEach((now, key) => {
      const was = before.get(key);
      if (!was) return;
      matched += 1;
      if (was.score >= WEAK_SCORE && now.score < WEAK_SCORE) regressions.push({ question: now.question, metric: now.metric, from: was.score, to: now.score });
      if (was.score < WEAK_SCORE && now.score >= WEAK_SCORE) improvements.push({ question: now.question, metric: now.metric, from: was.score, to: now.score });
    });
    const metrics = current.summary.map(m => {
      const base = baseline.summary.find(b => b.metric === m.metric);
      const delta = base && base.avgScore !== null && m.avgScore !== null ? m.avgScore - base.avgScore : null;
      return { metric: m.metric, from: base ? base.avgScore : null, to: m.avgScore, delta };
    });
    return { regressions, improvements, matched, metrics };
  }, [baseline, current]);

  const title = `${EVALS_TEXT.COMPARE_TITLE}: ${baselineName} → ${currentName}`;

  if (loading) {
    return <Panel title={title}><Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box></Panel>;
  }
  if (error) return <ErrorAlert message={error} />;
  if (!diff) return null;

  const changeRows = (rows: typeof diff.regressions, kindLabel: 'regression' | 'improvement') =>
    rows.map(r => (
      <TableRow key={`${kindLabel}-${r.question}-${r.metric}`}>
        <TableCell>{r.question}</TableCell>
        <TableCell>{r.metric}</TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {formatScore(r.from)} → {formatScore(r.to)}
        </TableCell>
      </TableRow>
    ));

  return (
    <Panel title={title}>
      <Stack spacing={2.5}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Metric</TableCell>
              <TableCell align="right">Baseline</TableCell>
              <TableCell align="right">This run</TableCell>
              <TableCell align="right">Change</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {diff.metrics.map(m => (
              <TableRow key={m.metric}>
                <TableCell>{m.metric}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatScore(m.from)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatScore(m.to)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {m.delta === null ? '—' : (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      {m.delta > 0.005 && <UpIcon sx={{ fontSize: 14 }} color="success" aria-label="Up" />}
                      {m.delta < -0.005 && <DownIcon sx={{ fontSize: 14 }} color="error" aria-label="Down" />}
                      {`${m.delta > 0 ? '+' : ''}${m.delta.toFixed(2)}`}
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {diff.matched === 0 && (
          <Typography color="text.secondary">{EVALS_TEXT.COMPARE_NO_MATCH}</Typography>
        )}

        {diff.matched > 0 && diff.regressions.length === 0 && diff.improvements.length === 0 && (
          <Typography color="text.secondary">{EVALS_TEXT.COMPARE_NO_CHANGES(WEAK_SCORE)}</Typography>
        )}

        {diff.regressions.length > 0 && (
          <Box>
            <Typography variant="subtitle2" color="error" sx={{ mb: 0.5 }}>
              {EVALS_TEXT.REGRESSIONS(diff.regressions.length)}
            </Typography>
            <Table size="small"><TableBody>{changeRows(diff.regressions, 'regression')}</TableBody></Table>
          </Box>
        )}

        {diff.improvements.length > 0 && (
          <Box>
            <Typography variant="subtitle2" color="success.main" sx={{ mb: 0.5 }}>
              {EVALS_TEXT.IMPROVEMENTS(diff.improvements.length)}
            </Typography>
            <Table size="small"><TableBody>{changeRows(diff.improvements, 'improvement')}</TableBody></Table>
          </Box>
        )}
      </Stack>
    </Panel>
  );
};
