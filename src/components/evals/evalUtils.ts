/**
 * Helpers shared by the eval panels: run naming, status colors, and reshaping the
 * one-row-per-question-per-metric result set into a question × metric grid.
 */

import { ChipProps } from '@mui/material';
import { EvalRecord, EvalRunStatus } from '../../services/snowflakeEvalsApi';
import { toText } from './shared';

export const defaultRunName = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `run_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};

export const statusColor = (status: EvalRunStatus): ChipProps['color'] => {
  if (status === 'COMPLETED') return 'success';
  if (status === 'PARTIALLY_COMPLETED' || status === 'INVOCATION_PARTIALLY_COMPLETED') return 'warning';
  if (status.endsWith('IN_PROGRESS') || status === 'RUNNING' || status === 'CREATED' || status === 'INVOCATION_COMPLETED') return 'info';
  return 'default';
};

/** Question text from an eval row; INPUT can be a plain string or a JSON payload. */
export const questionOf = (r: EvalRecord): string => {
  const input = r.INPUT;
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const candidate = obj.query_text ?? obj.input_query ?? obj.question ?? obj.input;
    if (typeof candidate === 'string') return candidate;
  }
  return toText(input);
};

export interface GridRow {
  recordId: string;
  question: string;
  output: string;
  groundTruth: string;
  error: string;
  scores: Record<string, number | null>;
  /** The raw result row for each metric, for the details dialog */
  rawByMetric: Record<string, EvalRecord>;
  minScore: number | null;
  durationMs: number | null;
}

export const buildGrid = (records: EvalRecord[]): { metrics: string[]; rows: GridRow[] } => {
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
      error: toText(r.ERROR),
      scores: {},
      rawByMetric: {},
      minScore: null,
      durationMs: typeof r.DURATION_MS === 'number' ? r.DURATION_MS : null
    };
    const score = typeof r.EVAL_AGG_SCORE === 'number' ? r.EVAL_AGG_SCORE : null;
    row.scores[metric] = score;
    row.rawByMetric[metric] = r;
    if (score !== null) row.minScore = row.minScore === null ? score : Math.min(row.minScore, score);
    byRecord.set(recordId, row);
  });
  const rows = Array.from(byRecord.values()).sort((a, b) => (a.minScore ?? 1) - (b.minScore ?? 1));
  return { metrics: Array.from(metrics).sort(), rows };
};
