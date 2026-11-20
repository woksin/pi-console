import { SqliteEventLog, type Driver } from '../event-log.ts';

const log = new SqliteEventLog(process.argv[2] as Driver, process.argv[3]!);
log.append([{ idempotencyKey: 'committed', type: 'Observed', version: 1, payload: {} }]);
const event = (id: string) => ({ idempotencyKey: id, type: 'Observed', version: 1, payload: {} });
const paused = event('mid-batch');
// append() serializes this payload after earlier inserts but before COMMIT.
paused.payload = { toJSON() {
    process.send!('mid-batch');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    return {};
} };
log.append([...Array.from({ length: 1000 }, (_, index) => event(`pending-${index}`)), paused]);
throw new Error('Expected SIGKILL before commit');
