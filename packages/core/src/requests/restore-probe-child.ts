// Child side of the warm-restore memory probe (run with --expose-gc): restores the requests projection and reports heap.
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { Projector } from '../projector/projector.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { requestDerivation } from './derivation.ts';
import { createRequestHistoryRuntime } from './history-runtime.ts';

const [path, mode] = process.argv.slice(2);
const collect = (global as unknown as { gc: () => void }).gc;
const store = new SqliteProjectionStore(path);
const log = new SqliteEventLog(':memory:');
collect();
const baseline = process.memoryUsage().heapUsed;
const runtimes = mode === 'lazy' ? { requests: createRequestHistoryRuntime(store) } : ({} as Record<string, never>);
const projector = new Projector(log, [requestDerivation], store, runtimes);
const afterRestore = process.memoryUsage().heapUsed;
collect();
const retained = process.memoryUsage().heapUsed;
const state = projector.state('requests') as { sessions: Record<string, { observations: unknown[] }> };
const resident = Object.values(state.sessions).reduce((sum, session) => sum + session.observations.length, 0);
process.stdout.write(JSON.stringify({ restoreOverhead: afterRestore - baseline, retainedOverhead: retained - baseline, resident, hydrations: store.requestSessions.hydrations }));
store.close();
log.close();
