import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqliteEventLog } from './event-log/sqlite-event-log.ts';
import { SqliteProjectionStore } from './projector/sqlite-projection-store.ts';

for (const Store of [SqliteEventLog, SqliteProjectionStore]) {
  for (const method of ['exec', 'prepare'] as const) {
    test(`${Store.name} closes its SQLite handle when ${method} fails during construction`, t => {
      const original = new Error('SQLite initialization failed');
      const opened: DatabaseSync[] = [];
      t.mock.method(DatabaseSync.prototype, method, function (this: DatabaseSync) {
        opened.push(this);
        throw original;
      });
      t.after(() => { for (const database of opened) if (database.isOpen) database.close(); });
      assert.throws(() => new Store(':memory:'), error => error === original);
      assert.equal(opened.length, 1);
      assert.equal(opened[0]?.isOpen, false);
    });
  }
}
