import { field } from '@cratis/fundamentals';
import { command, inject, key, query, readModel, service } from '@cratis/arc.core';
import { drizzleDatabase, drizzleReadModel, type DrizzleHandle, type DrizzleReadModels } from '@cratis/arc.drizzle';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Observable } from 'rxjs';

export const rows = sqliteTable('rows', {
    id: text('id').primaryKey(),
    title: text('title').notNull()
});

export class Row {
    @field(String) @key() id!: string;
    @field(String) title!: string;
}

@command()
export class AddRow {
    @field(String) id!: string;
    @field(String) title!: string;

    @inject(drizzleDatabase<BetterSQLite3Database>())
    handle(database: DrizzleHandle<BetterSQLite3Database>): void {
        database.native.insert(rows).values({ id: this.id, title: this.title }).run();
        database.notifyChanged(rows);
    }
}

@readModel()
export class RowQueries {
    @query({ observable: true }, service(drizzleReadModel(Row)))
    static all(records: DrizzleReadModels<Row>): Observable<Row[]> {
        return records.observe();
    }
}
