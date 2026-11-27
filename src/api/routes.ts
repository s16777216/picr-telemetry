import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';
import { readText } from '../db/texts.ts';

// The read API (`add-review-trace-server` design, Decision 6). It never writes.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

interface RunRow {
  trace_id: string;
  state: string;
  project_id: string | null;
  mr_iid: string | null;
  head_sha: string | null;
  model: string | null;
  started_at: number | null;
  ended_at: number | null;
  findings: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_total: number;
  last_seen_at: number;
}

/** A run as the API gives it. */
export interface RunView {
  traceId: string;
  state: string;
  projectId: string | null;
  mrIid: string | null;
  headSha: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  findings: number | null;
  inputTokens: number;
  outputTokens: number;
  costTotal: number;
  lastSeenAt: number;
}

function toView(row: RunRow): RunView {
  return {
    traceId: row.trace_id,
    state: row.state,
    projectId: row.project_id,
    mrIid: row.mr_iid,
    headSha: row.head_sha,
    model: row.model,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.started_at !== null && row.ended_at !== null ? row.ended_at - row.started_at : null,
    findings: row.findings,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costTotal: row.cost_total,
    lastSeenAt: row.last_seen_at,
  };
}

const TRACE_ID = /^[0-9a-f]{32}$/;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Registers the read API and `/healthz` on `app`. */
export function registerApi(app: FastifyInstance, db: Db): void {
  app.get('/api/runs', async (request) => {
    const query = request.query as Record<string, unknown>;
    const where: string[] = [];
    const params: (string | number)[] = [];
    const project = text(query.project);
    const mr = text(query.mr);
    const state = text(query.state);
    const before = Number(text(query.before));
    if (project !== undefined) {
      where.push('project_id = ?');
      params.push(project);
    }
    if (mr !== undefined) {
      where.push('mr_iid = ?');
      params.push(mr);
    }
    if (state !== undefined) {
      where.push('state = ?');
      params.push(state);
    }
    if (Number.isFinite(before)) {
      where.push('started_at < ?');
      params.push(before);
    }
    const requested = Number(text(query.limit));
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
    const rows = db
      .prepare(
        `SELECT * FROM runs ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY started_at DESC NULLS LAST, trace_id LIMIT ?`,
      )
      .all(...params, limit) as RunRow[];
    return { runs: rows.map(toView) };
  });

  app.get('/api/runs/:traceId', async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    const row = TRACE_ID.test(traceId)
      ? (db.prepare('SELECT * FROM runs WHERE trace_id = ?').get(traceId) as RunRow | undefined)
      : undefined;
    if (row === undefined) return reply.code(404).send({ message: `No run has the trace ID "${traceId}".` });
    return toView(row);
  });

  app.get('/api/runs/:traceId/spans', async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    if (!TRACE_ID.test(traceId) || db.prepare('SELECT 1 FROM runs WHERE trace_id = ?').get(traceId) === undefined) {
      return reply.code(404).send({ message: `No run has the trace ID "${traceId}".` });
    }
    const spans = db
      .prepare(
        `SELECT span_id, parent_id, name, start_ns, end_ns, status, status_msg, attrs FROM spans
         WHERE trace_id = ? ORDER BY LENGTH(start_ns), start_ns, span_id`,
      )
      .all(traceId) as {
      span_id: string;
      parent_id: string | null;
      name: string;
      start_ns: string;
      end_ns: string;
      status: string;
      status_msg: string | null;
      attrs: string;
    }[];
    const events = db
      .prepare('SELECT span_id, name, time_ns, attrs FROM events WHERE trace_id = ? ORDER BY span_id, seq')
      .all(traceId) as { span_id: string; name: string; time_ns: string; attrs: string }[];
    const eventsBySpan = new Map<string, { name: string; timeNs: string; attrs: unknown }[]>();
    for (const event of events) {
      const list = eventsBySpan.get(event.span_id) ?? [];
      list.push({ name: event.name, timeNs: event.time_ns, attrs: JSON.parse(event.attrs) });
      eventsBySpan.set(event.span_id, list);
    }
    return {
      spans: spans.map((span) => ({
        spanId: span.span_id,
        parentId: span.parent_id,
        name: span.name,
        startNs: span.start_ns,
        endNs: span.end_ns,
        status: span.status,
        statusMessage: span.status_msg,
        attrs: JSON.parse(span.attrs),
        events: eventsBySpan.get(span.span_id) ?? [],
      })),
    };
  });

  app.get('/api/texts/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const value = Number.isInteger(id) ? readText(db, id) : undefined;
    if (value === undefined) return reply.code(404).send({ message: 'No text has this reference.' });
    return reply.type('text/plain; charset=utf-8').send(value);
  });

  app.get('/healthz', async (_request, reply) => {
    try {
      db.prepare('SELECT COUNT(*) FROM runs').get();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
