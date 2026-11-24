/** Curated synthetic scenario corpus for the fixture: small, specific tasks with deterministic wording. Model names are examples, not a provider integration claim. */
export const models = ['claude-sonnet-4-5', 'claude-haiku-4-5', 'gpt-5-mini'] as const;

/** Session age at the observation time, in seconds, by status: live work is seconds old, finished work hours old. */
export const ageSeconds: Record<string, readonly number[]> = {
  working: [12, 48, 25, 36, 20], 'needs-you': [95, 190, 135, 240, 150], blocked: [420, 600, 780, 520, 900],
  waiting: [1500, 1800, 2100, 1650, 2700], idle: [3300, 3900, 4200, 5400, 3600],
  done: [7200, 6300, 9000, 7800, 8400], failed: [9600, 10200, 6900, 8100, 7500],
};

const costs = [0.42, 1.18, 3.64, 0.07, 0.91, 2.35, 5.8, 0.28, 1.76, 4.12];
/** Deterministic session spend: a few sessions are deliberately unknown (null), known-zero or incomplete. */
export function sessionSpend(index: number): { costUsd: number | null; costIncomplete: boolean } {
  const group = Math.floor(index / 5);
  const costUsd = index % 11 === 10 ? null : index === 15 ? 0 : Math.round(costs[(index * 7) % 10] * (1 + group * 0.15) * 100) / 100;
  return { costUsd, costIncomplete: index % 9 === 4 };
}

export const requestTexts = [
  'Compare the queue strategies and explain the trade-offs.',
  'Write the handoff and preserve the pending decisions.',
  'Check whether the retry policy handles partial results.',
  'Find out why the cache expires entries before their TTL.',
  'Make the CLI help output fit an 80 column terminal.',
  'Isolate the tests that share a temporary directory.',
  'Dry-run the schema migration and list the tables it would touch.',
  'Check that old clients still read the new schema version.',
  'Draft the release notes from the merged changes.',
  'Cancel pending retries when the job is stopped.',
  'Add a checkpoint after every queue batch.',
  'Trim the migration dry-run output to the changed rows.',
];

export const requestAnswers: Record<number, string> = {
  3: 'The sweep ran on a 60s timer, so entries outlived their TTL by up to a minute; it now sweeps on read.',
  7: 'Clients one version behind still parse the new schema; two versions behind fail with a clear error.',
  11: 'The dry run now prints only the changed rows and a count of the rows it skipped.',
};

export const questionDefs = [
  { text: 'Which retention window should the cache use?', options: ['Keep 14 days', 'Keep 30 days'] },
  { text: 'Ship the schema change behind a flag or all at once?', options: ['Behind a flag', 'All at once'] },
  { text: 'May the migration dry run write its plan to disk?', options: ['Yes, write it', 'No, print only'] },
  { text: 'The release checklist has two unchecked items; continue anyway?', options: ['Continue', 'Wait for the owner'] },
  { text: 'How many retries before a job is marked failed?', options: ['3 retries', '5 retries'] },
  { text: 'Should cancelled jobs keep their partial output?', options: ['Keep it', 'Discard it'] },
  { text: 'Allow the test runner to delete stale temp directories?', options: ['Allow', 'Skip cleanup'] },
  { text: 'The CLI help snapshot changed; accept the new wording?', options: ['Accept', 'Review first'] },
];

export const jobDefs = [
  { kind: 'job', name: 'watch inbox for replies' }, { kind: 'phase', name: 'unit checks: queue' }, { kind: 'ci', name: 'release verification' },
  { kind: 'job', name: 'watch cache sweep logs' }, { kind: 'phase', name: 'schema compatibility checks' }, { kind: 'ci', name: 'lint and typecheck' },
  { kind: 'job', name: 'watch migration dry run' }, { kind: 'phase', name: 'test isolation checks' }, { kind: 'ci', name: 'release verification (rc2)' },
];

interface Topic {
  noun: string; task: string; concern: string; plan: string; done: string; constant: string; fn: string; files: string[];
}
/** Topic order matters: the first three turns answer requests r1-r3. */
const topics: Topic[] = [
  { noun: 'the queue checkpoint contract', task: 'persist a checkpoint after each queue batch', concern: 'a batch is acknowledged', plan: 'write the checkpoint before acknowledging the batch', done: 'The queue now writes a checkpoint before it acknowledges a batch', constant: 'batchSize', fn: 'saveCheckpoint', files: ['src/queue/checkpoint.ts', 'src/queue/batch.ts', 'src/queue/worker.ts'] },
  { noun: 'the release notes', task: 'collect the merged changes into release notes', concern: 'the notes are assembled', plan: 'keep the pending decisions in the handoff', done: 'The handoff lists the pending decisions next to the notes', constant: 'noteLimit', fn: 'writeHandoff', files: ['src/release/handoff.ts', 'src/release/notes.ts', 'src/release/checklist.ts'] },
  { noun: 'the retry cancellation path', task: 'stop retrying a job once it is cancelled', concern: 'the retry budget is spent', plan: 'check for cancellation before each retry', done: 'Partial results now count against the retry budget and cancelled jobs stop retrying', constant: 'retryLimit', fn: 'shouldRetry', files: ['src/retry/policy.ts', 'src/retry/cancel.ts', 'src/jobs/runner.ts'] },
  { noun: 'the cache expiry sweep', task: 'expire cache entries at their TTL', concern: 'entries are swept', plan: 'sweep on read instead of waiting for the timer', done: 'Expired entries are now dropped on read', constant: 'ttlSeconds', fn: 'isExpired', files: ['src/cache/expiry.ts', 'src/cache/store.ts', 'src/cache/sweep.ts'] },
  { noun: 'the schema compatibility check', task: 'keep older clients reading the new schema', concern: 'versions are compared', plan: 'allow one version of skew and fail clearly beyond it', done: 'Clients one version behind keep working and older ones get a clear error', constant: 'maxVersionSkew', fn: 'isCompatible', files: ['src/schema/compat.ts', 'src/schema/registry.ts', 'src/schema/migrate.ts'] },
  { noun: 'the CLI help layout', task: 'fit the CLI help output into 80 columns', concern: 'help lines are wrapped', plan: 'wrap option descriptions at the terminal width', done: 'Help output wraps at 80 columns', constant: 'helpWidth', fn: 'wrapHelp', files: ['src/cli/help.ts', 'src/cli/parse.ts', 'src/cli/commands.ts'] },
  { noun: 'the test isolation setup', task: 'stop tests sharing a temporary directory', concern: 'temp directories are created', plan: 'give every worker its own temp directory', done: 'Each test worker now gets its own temp directory', constant: 'workerCount', fn: 'makeTempDir', files: ['test/support/tmpdir.ts', 'test/support/env.ts', 'test/setup.ts'] },
  { noun: 'the migration dry run', task: 'print only the rows a migration would change', concern: 'the plan is rendered', plan: 'skip unchanged rows and count them instead', done: 'The dry run lists changed rows and counts the skipped ones', constant: 'dryRunLimit', fn: 'renderPlan', files: ['src/migrate/dry-run.ts', 'src/migrate/plan.ts', 'src/migrate/apply.ts'] },
];

const verbs = ['Please', 'Next:', 'Now'];
const messageLeads = ['Please verify', 'Review complete for', 'Blocked until a decision on', 'Focused checks passed for', 'Ready to hand off'];
export const messageText = (index: number) => `${messageLeads[index % 5]} ${topics[index % 8].noun}.`;

export interface Turn { file: string; failed: boolean; truncated: boolean; texts: string[] }
/** One eight-entry turn: user, thinking, two assistant deltas, tool call, tool result, diff, final answer. */
export function turn(call: number): Turn {
  const topic = topics[call % 8];
  const round = Math.floor(call / 8);
  const file = topic.files[round % 3];
  const failed = call % 7 === 3;
  const n = 2 + (call * 5) % 9;
  const tests = 8 + (call * 7) % 33;
  const seconds = (0.4 + ((call * 13) % 90) / 10).toFixed(1);
  const user = call < requestTexts.length && call < 3 ? requestTexts[call] : `${verbs[Math.floor(round / 3) % 3]} ${topic.task}; start with ${file}.`;
  const snippet = failed ? `ENOENT: no such file or directory, open '${file}'` : `export const ${topic.constant} = ${String(n)};\nexport function ${topic.fn}() { /* ... */ }`;
  const diff = failed
    ? `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n+export const ${topic.constant} = ${String(n + 1)};`
    : `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-export const ${topic.constant} = ${String(n)};\n+export const ${topic.constant} = ${String(n + 1)};`;
  const outcome = failed ? `${file} did not exist, so I created it with ${topic.constant} set to ${String(n + 1)}` : `${topic.done}; ${topic.constant} is now ${String(n + 1)} in ${file}`;
  return {
    file, failed, truncated: call % 5 === 0,
    texts: [user, `${file} is where ${topic.concern}; reading it before I change anything.`, `I'll start with ${file}, `, `then ${topic.plan}. `, `read ${file}`, snippet, diff, `${outcome}, and ${String(tests)} specs pass in ${seconds}s.`],
  };
}
