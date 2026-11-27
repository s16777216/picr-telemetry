// Measures one ingest request of 512 spans, each with a 100,000-character text
// (task 3.6). Run with: npx tsx src/testing/measure-ingest.ts
import { openDatabase } from '../db/database.ts';
import { buildIngestServer } from '../ingest/routes.ts';
import { hexId, traceRequest, type FixtureSpan } from './fixtures.ts';

const traceId = hexId(32);
const parent = hexId(16);
const text = Array.from({ length: 100_000 / 20 }, (_, i) => `line ${String(i).padStart(8, '0')}.\n`)
  .join('')
  .slice(0, 100_000);
const spans: FixtureSpan[] = Array.from({ length: 512 }, (_, i) => ({
  traceId,
  spanId: hexId(16),
  parentSpanId: parent,
  name: 'picr.tool_call',
  startMs: i,
  attributes: { 'picr.tool.name': 'get_file_content', 'picr.tool.result': text },
}));
const body = JSON.stringify(traceRequest(spans));
const db = openDatabase(':memory:');
const app = buildIngestServer(db);
const started = performance.now();
const response = await app.inject({
  method: 'POST',
  url: '/v1/traces',
  headers: { 'content-type': 'application/json' },
  payload: body,
});
const ms = Math.round(performance.now() - started);
const stored = db.prepare('SELECT COUNT(*) AS n, SUM(LENGTH(gzip)) AS bytes FROM texts').get() as {
  n: number;
  bytes: number;
};
console.log(
  JSON.stringify({
    status: response.statusCode,
    bodyMB: +(Buffer.byteLength(body) / 1024 / 1024).toFixed(1),
    ms,
    texts: stored.n,
    gzipMB: +(stored.bytes / 1024 / 1024).toFixed(2),
  }),
);
