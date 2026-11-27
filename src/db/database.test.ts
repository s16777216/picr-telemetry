import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { isTextRef, readText, storeLongTexts, TEXT_LIMIT } from './texts.ts';

function withDatabaseFile(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'picr-telemetry-'));
  try {
    run(join(dir, 'nested', 'db.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a new database has every table and index of the design, in WAL mode', () => {
  withDatabaseFile((path) => {
    const db = openDatabase(path);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    for (const name of [
      'runs',
      'spans',
      'events',
      'ignored_traces',
      'texts',
      'schema_version',
      'runs_mr',
      'runs_time',
      'spans_parent',
    ]) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('auto_vacuum', { simple: true }), 2);
    db.close();
  });
});

test('a second open does not apply the schema again', () => {
  withDatabaseFile((path) => {
    const first = openDatabase(path);
    first.prepare("INSERT INTO runs (trace_id, state, last_seen_at) VALUES ('t1', 'running', 1)").run();
    first.close();
    const second = openDatabase(path);
    assert.equal((second.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n, 1);
    assert.equal((second.prepare('SELECT version FROM schema_version').all() as unknown[]).length, 1);
    second.close();
  });
});

test('a long text is stored apart and reads back the same', () => {
  const db = openDatabase(':memory:');
  const prompt = 'é'.repeat(25_000) + 'x'.repeat(25_000);
  const stored = storeLongTexts(db, 't1', 's1', { 'picr.prompt.user': prompt, 'picr.tool.path': 'src/a.ts' });
  const ref = stored['picr.prompt.user'];
  assert.ok(isTextRef(ref));
  assert.equal(ref.length, 50_000);
  assert.equal(readText(db, ref.$text), prompt);
  assert.equal(stored['picr.tool.path'], 'src/a.ts');
});

test('a text at the limit stays in the span', () => {
  const db = openDatabase(':memory:');
  const text = 'y'.repeat(TEXT_LIMIT);
  assert.equal(storeLongTexts(db, 't1', 's1', { a: text }).a, text);
  assert.equal(readText(db, 999), undefined);
});
