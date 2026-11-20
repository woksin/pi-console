// Subprocess fixture: exit without closing SQLite while its transaction is open.
import { EventLog } from './event-log.ts';
import { JsonlTailer } from './tailer.ts';

function crashInTransaction(): void {
    const [database, source] = process.argv.slice(2);
    const log = new EventLog(database);
    const tailer = new JsonlTailer(log, 'fixture', { beforeCommit: () => process.exit(73) });
    tailer.poll([source]);
}
crashInTransaction();
