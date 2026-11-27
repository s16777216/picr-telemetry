import type { Db } from './db/database.ts';

// The two sweepers (`add-review-trace-server` design, Decision 5). Each takes
// the current time, so the tests can pass any clock.

/** A `running` run with no span for this long becomes `error`. */
export const STALE_AFTER_MS = 30 * 60_000;
/** How often the service looks for stale runs. */
export const STALE_CHECK_EVERY_MS = 5 * 60_000;
/** How often the service deletes old data. */
export const DELETE_EVERY_MS = 24 * 60 * 60_000;
/** How long an ignored trace ID is kept. */
export const IGNORED_TRACE_KEEP_MS = 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** Sets `error` for each `running` run with no span in the last 30 minutes.
 * Returns the number of changed runs. */
export function markStaleRuns(db: Db, now: number): number {
  return db
    .prepare("UPDATE runs SET state = 'error' WHERE state = 'running' AND last_seen_at < ?")
    .run(now - STALE_AFTER_MS).changes;
}

/** Deletes each run whose last span arrived more than `retentionDays` ago,
 * with its spans, events, and texts, and each ignored trace ID older than
 * one day. Returns the number of deleted runs. */
export function deleteOldData(db: Db, now: number, retentionDays: number): number {
  const cutoff = now - retentionDays * DAY_MS;
  const deleted = db.transaction(() => {
    const old = (
      db.prepare('SELECT trace_id FROM runs WHERE last_seen_at < ?').all(cutoff) as { trace_id: string }[]
    ).map((row) => row.trace_id);
    for (const table of ['spans', 'events', 'texts', 'runs']) {
      const remove = db.prepare(`DELETE FROM ${table} WHERE trace_id = ?`);
      for (const traceId of old) remove.run(traceId);
    }
    db.prepare('DELETE FROM ignored_traces WHERE ignored_at < ?').run(now - IGNORED_TRACE_KEEP_MS);
    return old.length;
  })();
  if (deleted > 0) db.pragma('incremental_vacuum');
  return deleted;
}
