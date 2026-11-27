import type { Db } from '../db/database.ts';
import { deleteSpanTexts, storeLongTexts, type Attrs } from '../db/texts.ts';
import { nanosToMs, type ParsedSpan } from './parse.ts';

// Writes parsed spans in one transaction, drops the traces of `publish`, and
// keeps the run record of each review (`add-review-trace-server` design,
// Decision 3).

const REVIEW_ROOT = 'picr.review';
const PUBLISH_ROOT = 'picr.publish';
const MODEL_REQUEST = 'picr.model_request';

function num(attrs: Attrs | undefined, key: string): number {
  const value = attrs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(attrs: Attrs, key: string): string | null {
  const value = attrs[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
}

/** Deletes everything that the service holds for one trace. */
export function deleteTrace(db: Db, traceId: string): void {
  for (const table of ['spans', 'events', 'texts', 'runs']) {
    db.prepare(`DELETE FROM ${table} WHERE trace_id = ?`).run(traceId);
  }
}

/** Stores the spans of one request in one transaction. `now` is the time of
 * arrival in epoch milliseconds. A failure leaves the database unchanged. */
export function storeSpans(db: Db, spans: readonly ParsedSpan[], now: number): void {
  const byTrace = new Map<string, ParsedSpan[]>();
  for (const span of spans) {
    const group = byTrace.get(span.traceId) ?? [];
    group.push(span);
    byTrace.set(span.traceId, group);
  }

  const isIgnored = db.prepare('SELECT 1 FROM ignored_traces WHERE trace_id = ?');
  const ignore = db.prepare('INSERT OR REPLACE INTO ignored_traces (trace_id, ignored_at) VALUES (?, ?)');
  const oldSpan = db.prepare('SELECT name, attrs FROM spans WHERE trace_id = ? AND span_id = ?');
  const deleteEvents = db.prepare('DELETE FROM events WHERE trace_id = ? AND span_id = ?');
  const upsertSpan = db.prepare(`
    INSERT INTO spans (trace_id, span_id, parent_id, name, start_ns, end_ns, status, status_msg, attrs)
    VALUES (@traceId, @spanId, @parentId, @name, @startNs, @endNs, @status, @statusMessage, @attrs)
    ON CONFLICT (trace_id, span_id) DO UPDATE SET
      parent_id = excluded.parent_id, name = excluded.name, start_ns = excluded.start_ns,
      end_ns = excluded.end_ns, status = excluded.status, status_msg = excluded.status_msg, attrs = excluded.attrs`);
  const insertEvent = db.prepare(
    'INSERT INTO events (trace_id, span_id, seq, name, time_ns, attrs) VALUES (?, ?, ?, ?, ?, ?)',
  );
  // A run gets its record with the first span. A span of a run that a sweeper
  // marked as stale shows that the run is alive, so the run is `running` again
  // until its root arrives.
  const touchRun = db.prepare(`
    INSERT INTO runs (trace_id, state, started_at, last_seen_at) VALUES (@traceId, 'running', @startMs, @now)
    ON CONFLICT (trace_id) DO UPDATE SET
      last_seen_at = @now,
      started_at = CASE WHEN ended_at IS NULL THEN MIN(COALESCE(started_at, @startMs), @startMs) ELSE started_at END,
      state = CASE WHEN ended_at IS NULL THEN 'running' ELSE state END`);
  const addUsage = db.prepare(`
    UPDATE runs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_total = cost_total + ?
    WHERE trace_id = ?`);
  const finishRun = db.prepare(`
    UPDATE runs SET state = @state, project_id = @projectId, mr_iid = @mrIid, head_sha = @headSha, model = @model,
      findings = @findings, started_at = @startMs, ended_at = @endMs
    WHERE trace_id = @traceId`);

  db.transaction(() => {
    for (const [traceId, group] of byTrace) {
      if (isIgnored.get(traceId) !== undefined) continue;
      // The traces of `publish` are not kept (spec "Drop the traces of publish runs").
      if (group.some((span) => span.parentId === null && span.name === PUBLISH_ROOT)) {
        deleteTrace(db, traceId);
        ignore.run(traceId, now);
        continue;
      }
      touchRun.run({ traceId, startMs: Math.min(...group.map((span) => nanosToMs(span.startNs))), now });

      for (const span of group) {
        const old = oldSpan.get(traceId, span.spanId) as { name: string; attrs: string } | undefined;
        deleteSpanTexts(db, traceId, span.spanId);
        deleteEvents.run(traceId, span.spanId);
        const attrs = storeLongTexts(db, traceId, span.spanId, span.attrs);
        upsertSpan.run({ ...span, attrs: JSON.stringify(attrs) });
        span.events.forEach((event, seq) => {
          const eventAttrs = storeLongTexts(db, traceId, span.spanId, event.attrs);
          insertEvent.run(traceId, span.spanId, seq, event.name, event.timeNs, JSON.stringify(eventAttrs));
        });

        // A model request that arrives again adds only the difference
        // (spec "A model request span arrives again").
        if (span.name === MODEL_REQUEST || old?.name === MODEL_REQUEST) {
          const before = old?.name === MODEL_REQUEST ? (JSON.parse(old.attrs) as Attrs) : undefined;
          const after = span.name === MODEL_REQUEST ? span.attrs : undefined;
          addUsage.run(
            num(after, 'usage.input') - num(before, 'usage.input'),
            num(after, 'usage.output') - num(before, 'usage.output'),
            num(after, 'cost.total') - num(before, 'cost.total'),
            traceId,
          );
        }

        if (span.parentId === null && span.name === REVIEW_ROOT) {
          const findings = span.attrs['picr.result.findings'];
          finishRun.run({
            traceId,
            state: span.status === 'error' ? 'error' : 'done',
            projectId: str(span.attrs, 'picr.source.projectId'),
            mrIid: str(span.attrs, 'picr.source.mergeRequestIid'),
            headSha: str(span.attrs, 'picr.snapshot.headSha'),
            model: str(span.attrs, 'picr.model'),
            findings: typeof findings === 'number' ? findings : null,
            startMs: nanosToMs(span.startNs),
            endMs: nanosToMs(span.endNs),
          });
        }
      }
    }
  })();
}
