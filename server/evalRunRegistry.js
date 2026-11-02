/**
 * Eval run registry.
 *
 * Snowflake has no function that lists eval runs, so whoever starts (or wants to
 * track) a run records it here: run name, agent, config path, start time, and the
 * last known status. Stored as a JSON file next to the server (path overridable
 * with EVAL_RUNS_FILE). In a container this is ephemeral; point EVAL_RUNS_FILE at
 * a mounted volume if you need it to survive restarts.
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

const listRuns = (agent) => {
  const runs = load();
  return (agent ? runs.filter((r) => r.agent === agent) : runs)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
};

const getRun = (agent, runName) => load().find((r) => r.agent === agent && r.runName === runName) || null;

const upsertRun = (run) => {
  const runs = load();
  const i = runs.findIndex((r) => r.agent === run.agent && r.runName === run.runName);
  const merged = i >= 0 ? { ...runs[i], ...run } : run;
  if (i >= 0) runs[i] = merged; else runs.push(merged);
  save(runs);
  return merged;
};

const removeRun = (agent, runName) => {
  const runs = load();
  const next = runs.filter((r) => !(r.agent === agent && r.runName === runName));
  save(next);
  return next.length !== runs.length;
};

module.exports = { listRuns, getRun, upsertRun, removeRun };
