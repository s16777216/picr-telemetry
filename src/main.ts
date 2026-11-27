import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { buildIngestServer } from './ingest/routes.ts';
import { DELETE_EVERY_MS, deleteOldData, markStaleRuns, STALE_CHECK_EVERY_MS } from './sweep.ts';
import { buildUiServer } from './ui.ts';

/** The built UI: `dist/web` next to `dist/server` after a build, or the same
 * folder seen from `src` when the service runs with `tsx`. */
function findWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '../web'), join(here, '../dist/web')].find((path) => existsSync(join(path, 'index.html')));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const ingest = buildIngestServer(db);
  const ui = buildUiServer(db, findWebRoot());

  const sweep = () => {
    const now = Date.now();
    const stale = markStaleRuns(db, now);
    if (stale > 0) console.log(`Marked ${stale} stale run(s) as error.`);
  };
  const clean = () => {
    const deleted = deleteOldData(db, Date.now(), config.retentionDays);
    if (deleted > 0) console.log(`Deleted ${deleted} run(s) older than ${config.retentionDays} days.`);
  };
  clean();
  const timers = [setInterval(sweep, STALE_CHECK_EVERY_MS), setInterval(clean, DELETE_EVERY_MS)];

  await ingest.listen({ host: config.host, port: config.ingestPort });
  await ui.listen({ host: config.host, port: config.uiPort });
  console.log(
    `picr-telemetry: ingest on ${config.host}:${config.ingestPort}, UI on ${config.host}:${config.uiPort}, database ${config.databasePath}, retention ${config.retentionDays} days.`,
  );

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}; stopping.`);
    for (const timer of timers) clearInterval(timer);
    await Promise.allSettled([ingest.close(), ui.close()]);
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
