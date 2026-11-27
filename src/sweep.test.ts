import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type Db } from './db/database.ts';
import { parseTraceRequest } from './ingest/parse.ts';
import { storeSpans } from './ingest/store.ts';
import { deleteOldData, markStaleRuns } from './sweep.ts';
import { publishTrace, reviewTrace, traceRequest } from './testing/fixtures.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 27);

function storeAt(db: Db, request: Record<string, unknown>, now: number): void {
  storeSpans(db, parseTraceRequest(JSON.parse(JSON.stringify(request))), now);
}

function count(db: Db, table: string, traceId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE trace_id = ?`).get(traceId) as { n: number }).n;
}

function state(db: Db, traceId: string): string {
  return (db.prepare('SELECT state FROM runs WHERE trace_id = ?').get(traceId) as { state: string }).state;
}

test('a running run with its last span 31 minutes ago becomes error', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  storeAt(db, traceRequest(others), T0);
  assert.equal(markStaleRuns(db, T0 + 31 * MINUTE), 1);
  assert.equal(state(db, traceId), 'error');
});

test('a running run with its last span 2 minutes ago stays running', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  storeAt(db, traceRequest(others), T0);
  assert.equal(markStaleRuns(db, T0 + 2 * MINUTE), 0);
  assert.equal(state(db, traceId), 'running');
});

test('a done run is never marked stale', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace();
  storeAt(db, traceRequest([...others, root]), T0);
  markStaleRuns(db, T0 + 60 * MINUTE);
  assert.equal(state(db, traceId), 'done');
});

test('a run older than the retention period is deleted with all its data', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace();
  const withText = others.map((span) =>
    span.name === 'picr.agent_run' ? { ...span, attributes: { 'picr.prompt.user': 'p'.repeat(10_000) } } : span,
  );
  storeAt(db, traceRequest([...withText, root]), T0);
  assert.equal(count(db, 'texts', traceId), 1);
  assert.equal(deleteOldData(db, T0 + 91 * DAY, 90), 1);
  for (const table of ['runs', 'spans', 'events', 'texts']) assert.equal(count(db, table, traceId), 0, table);
});

test('a run inside the retention period is kept', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace();
  storeAt(db, traceRequest([...others, root]), T0);
  assert.equal(deleteOldData(db, T0 + 89 * DAY, 90), 0);
  assert.equal(count(db, 'spans', traceId), 6);
});

test('an ignored trace ID older than one day is deleted', () => {
  const db = openDatabase(':memory:');
  const { traceId, root } = publishTrace();
  storeAt(db, traceRequest([root]), T0);
  assert.equal(count(db, 'ignored_traces', traceId), 1);
  deleteOldData(db, T0 + 12 * 60 * MINUTE, 90);
  assert.equal(count(db, 'ignored_traces', traceId), 1);
  deleteOldData(db, T0 + DAY + MINUTE, 90);
  assert.equal(count(db, 'ignored_traces', traceId), 0);
});
