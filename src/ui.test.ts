import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './db/database.ts';
import { buildUiServer } from './ui.ts';

test('the UI server serves the built UI at / and the API under /api', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picr-web-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>picr Telemetry</title><div id="root"></div>');
    const app = buildUiServer(openDatabase(':memory:'), dir);
    const page = await app.inject({ method: 'GET', url: '/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /picr Telemetry/);
    assert.equal((await app.inject({ method: 'GET', url: '/api/runs' })).statusCode, 200);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without a built UI, / says how to build it', async () => {
  const app = buildUiServer(openDatabase(':memory:'), undefined);
  const page = await app.inject({ method: 'GET', url: '/' });
  assert.match(page.body, /npm run build/);
});
