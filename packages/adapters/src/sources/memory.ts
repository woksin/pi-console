import type { Fact, Mapper } from '../tailing/events.ts';
import { excerpt, fact, integer, list, object, text } from '../values.ts';

type Row = Record<string, unknown>;

const eventSchema = 'memory.event/2';
const journalSchema = 'memory.journal/2';
/** Owned by the request derivation (ADR-0008 Phase B); known so they never warn. */
const ignoredTypes = new Set(['boundary', 'request_close']);
const itemKinds = ['directive', 'order', 'decision'];
const scopeKinds = ['global', 'repo', 'lane', 'session', 'task'];
const sourceTypes = ['user_message', 'coordinator_order', 'agent_decision', 'question_item'];
const authorityModes = ['auto', 'command', 'none'];
const retireStatuses = ['done', 'superseded', 'withdrawn', 'rejected'];
const origins = ['human', 'unattended', 'launch', 'injected'];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

/** CRC-32 (IEEE) as lowercase 8-digit hex, the producer's record checksum. */
export function crc32(input: string): string {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(input, 'utf8')) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** The checksum covers the record without `crc`, in its own key order; a mismatch means a corrupt or torn record. */
function verified(value: Row, schema: string): Row {
  if (value.schema !== schema) throw new Error('Unknown memory schema');
  const { crc, ...body } = value;
  if (typeof crc !== 'string' || crc32(JSON.stringify(body)) !== crc) throw new Error('Memory record checksum mismatch');
  return body;
}

function member(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('Unknown memory value');
  return value;
}

function added(row: Row): Fact {
  const item = object(row.item);
  const source = object(item.source);
  const itemId = text(item.id);
  const sourceType = member(source.type, sourceTypes);
  const sourceRef = optionalText(source.ref);
  const scope = object(item.scope);
  const body = excerpt(text(item.text));
  const gloss = item.gloss === undefined ? {} : { gloss: excerpt(item.gloss).excerpt };
  return fact('MemoryItemRecorded', `source:memory-item:${itemId}`, {
    itemId, kind: member(item.kind, itemKinds), scopeKind: member(scope.kind, scopeKinds), scopeKey: text(scope.key), sourceType,
    sourceMessageId: sourceType === 'user_message' || sourceType === 'coordinator_order' ? sourceRef : null,
    authorityMode: authorityMode(item.authority),
    supersedes: supersededIds(item.supersedes), ...body, ...gloss,
  }, row.at, text(row.id));
}

function optionalText(value: unknown): string | null {
  return value === undefined ? null : text(value);
}

function authorityMode(value: unknown): string | null {
  return value === undefined ? null : member(object(value).mode, authorityModes);
}

function supersededIds(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(text);
}

const actorKind = (row: Row) => text(object(row.actor).kind);

const eventTypes: Record<string, (row: Row) => Fact> = {
  add: added,
  confirm: row => fact('MemoryItemConfirmed', `source:memory-item:${text(row.itemId)}`, { itemId: text(row.itemId), actorKind: actorKind(row) }, row.at, text(row.id)),
  retire: row => fact('MemoryItemRetired', `source:memory-item:${text(row.itemId)}`, {
    itemId: text(row.itemId), status: member(row.status, retireStatuses), actorKind: actorKind(row),
    reasonExcerpt: excerpt(typeof row.reason === 'string' ? row.reason : '').excerpt,
  }, row.at, text(row.id)),
  classify: row => fact('MemoryMessageClassified', `message:${text(row.messageId)}`, {
    messageId: text(row.messageId), whole: row.whole === 'none' ? 'none' : nullOnly(row.whole), spanCount: list(row.spans).length,
  }, row.at, text(row.id)),
};

function nullOnly(value: unknown): null {
  if (value !== null && value !== undefined) throw new Error('Unknown classification');
  return null;
}

/** `events.jsonl`: items and classifications. Unknown schemas and types throw; they are never guessed. */
export const memoryEventMapper: Mapper = value => {
  const row = verified(value, eventSchema);
  const type = text(row.type);
  if (ignoredTypes.has(type)) return [];
  const mapped = Object.hasOwn(eventTypes, type) ? eventTypes[type] : undefined;
  if (!mapped) throw new Error('Unknown memory event');
  return [mapped(row)];
};

function journalWithheld(row: Row): boolean {
  if (row.text !== null && typeof row.text !== 'string') throw new Error('Expected string or null');
  return row.text === null || (row.withheld !== null && row.withheld !== undefined);
}

/** `journal/<session>.jsonl`: metadata only. The message text is validated as present or null and then dropped. */
export const memoryJournalMapper: Mapper = value => {
  const row = verified(value, journalSchema);
  const withheld = journalWithheld(row);
  const sessionId = text(object(row.session).id);
  const messageId = text(row.id);
  return [fact('MemoryMessageRecorded', `session:${sessionId}`, {
    messageId, sessionId, origin: member(row.origin, origins),
    injectedKind: typeof row.injectedKind === 'string' ? row.injectedKind : null,
    withheld, textBytes: integer(row.textBytes),
  }, row.at, messageId)];
};
