import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { openDatabase, type Db } from '../db/database.ts';
import { reviewTrace, traceRequest } from '../testing/fixtures.ts';
import { buildIngestServer, MAX_BODY_BYTES } from './routes.ts';

function spanCount(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM spans').get() as { n: number }).n;
}

function validBody(): string {
  const { root, others } = reviewTrace();
  return JSON.stringify(traceRequest([root, ...others]));
}

test('a valid request is stored and answered with partialSuccess', async () => {
  const db = openDatabase(':memory:');
  const app = buildIngestServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json' },
    payload: validBody(),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { partialSuccess: {} });
  assert.equal(spanCount(db), 6);
});

test('a gzip body is stored, with no Authorization header', async () => {
  const db = openDatabase(':memory:');
  const app = buildIngestServer(db);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    payload: gzipSync(Buffer.from(validBody())),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(spanCount(db), 6);
});

test('a body that is not JSON gives 400 and stores nothing', async () => {
  const db = openDatabase(':memory:');
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json' },
    payload: 'not json',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(spanCount(db), 0);
});

test('a JSON body that is not a trace request gives 400', async () => {
  const db = openDatabase(':memory:');
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json' },
    payload: '{"resourceSpans": 5}',
  });
  assert.equal(response.statusCode, 400);
});

test('a protobuf request gives 415 and stores nothing', async () => {
  const db = openDatabase(':memory:');
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/x-protobuf' },
    payload: Buffer.from([1, 2, 3]),
  });
  assert.equal(response.statusCode, 415);
  assert.equal(spanCount(db), 0);
});

test('a gzip body over 64 MB after decompression gives 413 and stores nothing', async () => {
  const db = openDatabase(':memory:');
  const big = Buffer.alloc(MAX_BODY_BYTES + 1024 * 1024, 0x20);
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    payload: gzipSync(big),
  });
  assert.equal(response.statusCode, 413);
  assert.equal(spanCount(db), 0);
});

test('a plain body over 64 MB gives 413', async () => {
  const db = openDatabase(':memory:');
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json' },
    payload: Buffer.alloc(MAX_BODY_BYTES + 1, 0x20),
  });
  assert.equal(response.statusCode, 413);
});

test('a failed database write gives 503 and stores no span of the request', async () => {
  const db = openDatabase(':memory:');
  // A trigger that fails on the last span of the request makes the transaction roll back.
  db.exec(
    "CREATE TRIGGER fail_on_tool AFTER INSERT ON spans WHEN NEW.name = 'picr.tool_call' BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  const response = await buildIngestServer(db).inject({
    method: 'POST',
    url: '/v1/traces',
    headers: { 'content-type': 'application/json' },
    payload: validBody(),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(spanCount(db), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n, 0);
});
