import { ArcApplication } from '@cratis/arc.core';
import { cratisArc, serveCratisArc } from '@cratis/arc.hono';
import { DrizzleDialect, DrizzleObservation } from '@cratis/arc.drizzle';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { AddRow, Row, RowQueries, rows } from './Features/Rows.js';

const native = new Database(process.env.DATABASE ?? ':memory:');
native.pragma('journal_mode = WAL');
native.exec('CREATE TABLE IF NOT EXISTS rows (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
const builder = ArcApplication.createBuilder({ tenancy: { resolve: () => 'default' } });
await builder.discover(new URL('./Features/', import.meta.url));
builder.withDrizzle({
    dialect: DrizzleDialect.SQLite,
    database: drizzle(native),
    readModels: [{ type: Row, table: rows }],
    observation: DrizzleObservation.InProcess
});
// Discovery loads AddRow and RowQueries; these references also make the spike's artifacts explicit.
void AddRow;
void RowQueries;
const arc = await builder.build();
const app = new Hono();
app.use(cratisArc(arc));
app.use('*', serveStatic({ root: './dist/client' }));
const hosted = await serveCratisArc(app, arc, {
    port: Number(process.env.PORT ?? 3000), hostname: '127.0.0.1'
});
console.log(`READY ${JSON.stringify(hosted.server.address())}`);
async function close(): Promise<void> {
    await hosted.dispose();
    await arc.dispose();
    native.close();
}
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
