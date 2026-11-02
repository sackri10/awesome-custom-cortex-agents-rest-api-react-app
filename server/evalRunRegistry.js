/**
 * Eval run registry.
 *
 * Snowflake has no function that lists eval runs, so whoever starts (or wants to
 * track) a run records it here: run name, what it evaluates, config path, start time,
 * and the last known status. Stored as a JSON file next to the server (path
 * overridable with EVAL_RUNS_FILE). In a container this is ephemeral; point
 * EVAL_RUNS_FILE at a mounted volume if you need it to survive restarts.
 *
 * A run belongs to a target: kind 'agent' (target = agent name) or 'analyst'
 * (target = semantic view name). Entries written before analyst support have only an
 * `agent` field and are read as kind 'agent'.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.EVAL_RUNS_FILE || path.join(__dirname, '.data', 'eval_runs.json');

const load = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const save = (runs) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(runs, null, 2));
};

const kindOf = (r) => r.kind || 'agent';
const targetOf = (r) => r.target || r.agent;
const matches = (r, kind, target, runName) =>
  kindOf(r) === kind && targetOf(r) === target && (runName === undefined || r.runName === runName);

/** Normalize a stored entry so callers always see kind and target. */
const present = (r) => ({ ...r, kind: kindOf(r), target: targetOf(r), agent: kindOf(r) === 'agent' ? targetOf(r) : undefined });

const listRuns = (kind, target) =>
  load()
    .filter((r) => matches(r, kind, target))
    .map(present)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

const getRun = (kind, target, runName) => {
  const found = load().find((r) => matches(r, kind, target, runName));
  return found ? present(found) : null;
};

const upsertRun = (run) => {
  const runs = load();
  const kind = run.kind || 'agent';
  const target = run.target || run.agent;
  const i = runs.findIndex((r) => matches(r, kind, target, run.runName));
  const merged = { ...(i >= 0 ? runs[i] : {}), ...run, kind, target };
  if (i >= 0) runs[i] = merged; else runs.push(merged);
  save(runs);
  return present(merged);
};

const removeRun = (kind, target, runName) => {
  const runs = load();
  const next = runs.filter((r) => !matches(r, kind, target, runName));
  save(next);
  return next.length !== runs.length;
};

module.exports = { listRuns, getRun, upsertRun, removeRun };
