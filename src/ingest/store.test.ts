import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type Db } from '../db/database.ts';
import { BASE_MS, modelRequest, publishTrace, reviewTrace, traceRequest } from '../testing/fixtures.ts';
import { parseTraceRequest } from './parse.ts';
import { storeSpans } from './store.ts';

const NOW = BASE_MS + 120_000;

function store(db: Db, request: Record<string, unknown>, now = NOW): void {
  storeSpans(db, parseTraceRequest(JSON.parse(JSON.stringify(request))), now);
}

function count(db: Db, table: string, traceId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE trace_id = ?`).get(traceId) as { n: number }).n;
}

function run(db: Db, traceId: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM runs WHERE trace_id = ?').get(traceId) as Record<string, unknown>;
}

test('the same request twice keeps each span and event once', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace();
  const request = traceRequest([...others, root]);
  store(db, request);
  store(db, request);
  assert.equal(count(db, 'spans', traceId), 6);
  assert.equal(count(db, 'events', traceId), 1);
});

test('a child span is stored before its parent arrives', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  const agentRun = others.find((span) => span.name === 'picr.agent_run')!;
  store(db, traceRequest([agentRun]));
  const row = db
    .prepare('SELECT parent_id FROM spans WHERE trace_id = ? AND span_id = ?')
    .get(traceId, agentRun.spanId) as {
    parent_id: string;
  };
  assert.equal(row.parent_id, agentRun.parentSpanId);
});

test('a run in progress has the state running and the token sums of its model requests', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  const runId = others.find((span) => span.name === 'picr.agent_run')!.spanId;
  const requests = Array.from({ length: 50 }, (_, i) => modelRequest(traceId, runId, i * 100, 10, 20));
  store(db, traceRequest(requests));
  const record = run(db, traceId);
  assert.equal(record.state, 'running');
  assert.equal(record.input_tokens, 500);
  assert.equal(record.output_tokens, 1_000);
  assert.equal(record.last_seen_at, NOW);
});

test('the root span fills the run record and sets the state done', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace(undefined, { projectId: '10', mrIid: '66', findings: 54 });
  store(db, traceRequest(others));
  store(db, traceRequest([root]));
  const record = run(db, traceId);
  assert.equal(record.project_id, '10');
  assert.equal(record.mr_iid, '66');
  assert.equal(record.findings, 54);
  assert.equal(record.state, 'done');
  assert.equal(record.model, 'nemotron-3-ultra-550b-a55b');
  assert.equal(record.head_sha, '4eb7381ff8f0f451c6cba66274777b53000a3a51');
  assert.equal(record.started_at, BASE_MS);
  assert.equal(record.ended_at, BASE_MS + 60_000);
  assert.equal(record.input_tokens, 420);
  assert.equal(record.output_tokens, 1_943);
});

test('a root span with the status error gives the state error', () => {
  const db = openDatabase(':memory:');
  const { traceId, root } = reviewTrace(undefined, { rootStatus: 'error' });
  store(db, traceRequest([root]));
  assert.equal(run(db, traceId).state, 'error');
});

test('a model request span that arrives again is counted once', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  const request = others.find((span) => span.name === 'picr.model_request')!;
  store(db, traceRequest([request]));
  store(db, traceRequest([request]));
  assert.equal(run(db, traceId).input_tokens, 120);
  assert.equal(run(db, traceId).output_tokens, 842);
});

test('a publish trace in one request is not stored', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = publishTrace();
  store(db, traceRequest([...others, root]));
  assert.equal(count(db, 'spans', traceId), 0);
  assert.equal(count(db, 'runs', traceId), 0);
});

test('a publish root in a second request deletes the spans of the first request', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = publishTrace();
  store(db, traceRequest(others));
  assert.equal(count(db, 'spans', traceId), 1);
  store(db, traceRequest([root]));
  assert.equal(count(db, 'spans', traceId), 0);
  assert.equal(count(db, 'runs', traceId), 0);
});

test('a span of an ignored trace that arrives later is not stored', () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = publishTrace();
  store(db, traceRequest([root]));
  store(db, traceRequest(others), NOW + 10 * 60_000);
  assert.equal(count(db, 'spans', traceId), 0);
  assert.equal(count(db, 'runs', traceId), 0);
});

test('a span of a run that was marked stale makes it running again', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  store(db, traceRequest([others[0]!]));
  db.prepare("UPDATE runs SET state = 'error' WHERE trace_id = ?").run(traceId);
  store(db, traceRequest([others[1]!]));
  assert.equal(run(db, traceId).state, 'running');
});

test('a long prompt goes to the text store', () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  const agentRun = {
    ...others.find((span) => span.name === 'picr.agent_run')!,
    attributes: { 'picr.prompt.user': 'p'.repeat(50_000) },
  };
  store(db, traceRequest([agentRun]));
  const attrs = JSON.parse(
    (
      db.prepare('SELECT attrs FROM spans WHERE trace_id = ? AND span_id = ?').get(traceId, agentRun.spanId) as {
        attrs: string;
      }
    ).attrs,
  ) as Record<string, { $text: number; length: number }>;
  assert.equal(attrs['picr.prompt.user']!.length, 50_000);
  assert.equal(count(db, 'texts', traceId), 1);
  // Storing the span again replaces its text and keeps one copy.
  store(db, traceRequest([agentRun]));
  assert.equal(count(db, 'texts', traceId), 1);
});
