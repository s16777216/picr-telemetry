import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from './config.ts';

test('loadConfig gives the defaults when no variable is set', () => {
  assert.deepEqual(loadConfig({}), {
    host: '0.0.0.0',
    ingestPort: 4318,
    uiPort: 8080,
    databasePath: './data/picr-telemetry.sqlite',
    retentionDays: 90,
  });
});

test('loadConfig reads each variable', () => {
  assert.deepEqual(
    loadConfig({
      HOST: '127.0.0.1',
      INGEST_PORT: '14318',
      UI_PORT: '18080',
      DATABASE_PATH: '/var/lib/picr/db.sqlite',
      RETENTION_DAYS: '30',
    }),
    {
      host: '127.0.0.1',
      ingestPort: 14318,
      uiPort: 18080,
      databasePath: '/var/lib/picr/db.sqlite',
      retentionDays: 30,
    },
  );
});

test('loadConfig stops with a clear message for a value that is not valid', () => {
  assert.throws(
    () => loadConfig({ RETENTION_DAYS: 'abc' }),
    (error: unknown) => {
      return error instanceof ConfigError && /RETENTION_DAYS/.test(error.message) && /"abc"/.test(error.message);
    },
  );
  assert.throws(() => loadConfig({ RETENTION_DAYS: '0' }), ConfigError);
  assert.throws(() => loadConfig({ UI_PORT: '70000' }), /UI_PORT/);
});
