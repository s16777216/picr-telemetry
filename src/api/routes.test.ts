import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openDatabase, type Db } from '../db/database.ts';
import { parseTraceRequest } from '../ingest/parse.ts';
import { storeSpans } from '../ingest/store.ts';
import { reviewTrace, traceRequest, type FixtureSpan } from '../testing/fixtures.ts';
import { registerApi } from './routes.ts';

function store(db: Db, spans: FixtureSpan[], now = Date.now()): void {
  storeSpans(db, parseTraceRequest(JSON.parse(JSON.stringify(traceRequest(spans)))), now);
}

function api(db: Db) {
  const app = Fastify();
  registerApi(app, db);
  return app;
}

/** Stores a done run that started `offsetMs` after the fixture base time. */
function doneRun(db: Db, offsetMs: number, projectId = '10', mrIid = '66'): string {
  const { traceId, root, others } = reviewTrace(undefined, { projectId, mrIid });
  const shift = (span: FixtureSpan) => ({
    ...span,
    startMs: (span.startMs ?? 0) + offsetMs,
    endMs: (span.endMs ?? 10) + offsetMs,
  });
  store(db, [...others, root].map(shift));
  return traceId;
}

test('GET /api/runs needs no credentials and filters by project and merge request, newest first', async () => {
  const db = openDatabase(':memory:');
  const old = doneRun(db, 0);
  const other = doneRun(db, 1_000, '11', '5');
  const recent = doneRun(db, 2_000);
  const response = await api(db).inject({ method: 'GET', url: '/api/runs?project=10&mr=66' });
  assert.equal(response.statusCode, 200);
  const ids = (response.json() as { runs: { traceId: string }[] }).runs.map((run) => run.traceId);
  assert.deepEqual(ids, [recent, old]);
  assert.ok(!ids.includes(other));
});

test('GET /api/runs pages with before and limit', async () => {
  const db = openDatabase(':memory:');
  const ids = [0, 1, 2, 3].map((i) => doneRun(db, i * 1_000));
  const app = api(db);
  const first = (await app.inject({ method: 'GET', url: '/api/runs?limit=2' })).json() as {
    runs: { traceId: string; startedAt: number }[];
  };
  assert.deepEqual(
    first.runs.map((run) => run.traceId),
    [ids[3], ids[2]],
  );
  const second = (
    await app.inject({ method: 'GET', url: `/api/runs?limit=2&before=${first.runs[1]!.startedAt}` })
  ).json() as {
    runs: { traceId: string }[];
  };
  assert.deepEqual(
    second.runs.map((run) => run.traceId),
    [ids[1], ids[0]],
  );
});

test('GET /api/runs gives at most 200 runs', async () => {
  const db = openDatabase(':memory:');
  const insert = db.prepare("INSERT INTO runs (trace_id, state, started_at, last_seen_at) VALUES (?, 'done', ?, 1)");
  for (let i = 0; i < 250; i += 1) insert.run(i.toString(16).padStart(32, '0'), i);
  const body = (await api(db).inject({ method: 'GET', url: '/api/runs?limit=500' })).json() as { runs: unknown[] };
  assert.equal(body.runs.length, 200);
});

test('GET /api/runs lists a run in progress with its state and token sums', async () => {
  const db = openDatabase(':memory:');
  const { traceId, others } = reviewTrace();
  store(db, others);
  const body = (await api(db).inject({ method: 'GET', url: '/api/runs' })).json() as {
    runs: { traceId: string; state: string; inputTokens: number; projectId: string | null }[];
  };
  assert.deepEqual(
    body.runs.map((run) => [run.traceId, run.state, run.inputTokens, run.projectId]),
    [[traceId, 'running', 420, null]],
  );
});

test('GET /api/runs/:traceId gives a known run and 404 for an unknown one', async () => {
  const db = openDatabase(':memory:');
  const traceId = doneRun(db, 0);
  const app = api(db);
  const known = await app.inject({ method: 'GET', url: `/api/runs/${traceId}` });
  assert.equal(known.statusCode, 200);
  assert.equal((known.json() as { findings: number; durationMs: number }).findings, 54);
  assert.equal((known.json() as { durationMs: number }).durationMs, 60_000);
  const unknown = await app.inject({ method: 'GET', url: '/api/runs/0123456789abcdef0123456789abcdef' });
  assert.equal(unknown.statusCode, 404);
});

test('GET /api/runs/:traceId/spans gives a long prompt only as a reference, and the text reads back', async () => {
  const db = openDatabase(':memory:');
  const { traceId, root, others } = reviewTrace();
  const prompt = 'q'.repeat(50_000);
  store(db, [
    root,
    ...others.map((span) =>
      span.name === 'picr.agent_run'
        ? { ...span, attributes: { ...span.attributes, 'picr.prompt.user': prompt } }
        : span,
    ),
  ]);
  const app = api(db);
  const response = await app.inject({ method: 'GET', url: `/api/runs/${traceId}/spans` });
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.includes(prompt));
  const spans = (response.json() as { spans: { name: string; attrs: Record<string, unknown>; events: unknown[] }[] })
    .spans;
  assert.equal(spans.length, 6);
  const agentRun = spans.find((span) => span.name === 'picr.agent_run')!;
  const ref = agentRun.attrs['picr.prompt.user'] as { $text: number; length: number };
  assert.equal(ref.length, 50_000);
  assert.equal(agentRun.events.length, 1);

  const text = await app.inject({ method: 'GET', url: `/api/texts/${ref.$text}` });
  assert.equal(text.statusCode, 200);
  assert.match(String(text.headers['content-type']), /^text\/plain; charset=utf-8/);
  assert.equal(text.body, prompt);
  assert.equal((await app.inject({ method: 'GET', url: '/api/texts/99999' })).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/runs/0123456789abcdef0123456789abcdef/spans' })).statusCode,
    404,
  );
});

test('GET /healthz is 200 with a readable database and 503 without it', async () => {
  const db = openDatabase(':memory:');
  const app = api(db);
  assert.equal((await app.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
  db.close();
  assert.equal((await app.inject({ method: 'GET', url: '/healthz' })).statusCode, 503);
});
