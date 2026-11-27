import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Each migration moves the schema one version up. A new database runs all of
 * them in order; an existing one runs only the ones above its version
 * (`add-review-trace-server` design, Decision 2). */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE runs (
    trace_id      TEXT PRIMARY KEY,
    state         TEXT NOT NULL,
    project_id    TEXT,
    mr_iid        TEXT,
    head_sha      TEXT,
    model         TEXT,
    started_at    INTEGER,
    ended_at      INTEGER,
    findings      INTEGER,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_total    REAL NOT NULL DEFAULT 0,
    last_seen_at  INTEGER NOT NULL
  );
  CREATE INDEX runs_mr ON runs (project_id, mr_iid, started_at DESC);
  CREATE INDEX runs_time ON runs (started_at DESC);
  CREATE INDEX runs_seen ON runs (last_seen_at);

  CREATE TABLE spans (
    trace_id   TEXT NOT NULL,
    span_id    TEXT NOT NULL,
    parent_id  TEXT,
    name       TEXT NOT NULL,
    start_ns   TEXT NOT NULL,
    end_ns     TEXT NOT NULL,
    status     TEXT NOT NULL,
    status_msg TEXT,
    attrs      TEXT NOT NULL,
    PRIMARY KEY (trace_id, span_id)
  );
  CREATE INDEX spans_parent ON spans (trace_id, parent_id);

  CREATE TABLE events (
    trace_id TEXT NOT NULL,
    span_id  TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    name     TEXT NOT NULL,
    time_ns  TEXT NOT NULL,
    attrs    TEXT NOT NULL,
    PRIMARY KEY (trace_id, span_id, seq)
  );

  CREATE TABLE ignored_traces (
    trace_id   TEXT PRIMARY KEY,
    ignored_at INTEGER NOT NULL
  );

  CREATE TABLE texts (
    id       INTEGER PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id  TEXT NOT NULL,
    gzip     BLOB NOT NULL,
    length   INTEGER NOT NULL
  );
  CREATE INDEX texts_span ON texts (trace_id, span_id);
  `,
];

/** Opens the database at `path` (or `:memory:`), creates its folder, sets WAL
 * mode and incremental vacuum, and applies the migrations that are missing. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // `auto_vacuum` only takes effect before the first table exists.
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const current = row?.version ?? 0;
  if (current < MIGRATIONS.length) {
    db.transaction(() => {
      for (let version = current; version < MIGRATIONS.length; version += 1) db.exec(MIGRATIONS[version]!);
      db.prepare('DELETE FROM schema_version').run();
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(MIGRATIONS.length);
    })();
  }
  return db;
}
