// Builds OTLP/HTTP JSON trace requests in the shape that pi-code-review sends
// (`@opentelemetry/exporter-trace-otlp-http`): hex IDs, nanosecond times as
// decimal strings, and typed attribute values. This file is the single list of
// the `picr` span names and attributes that the service reads (design, Risks).

type Primitive = string | number | boolean;
export type FixtureValue = Primitive | Primitive[];

export interface FixtureSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Milliseconds after the start of the trace. */
  startMs?: number;
  endMs?: number;
  attributes?: Record<string, FixtureValue>;
  events?: { name: string; atMs?: number; attributes?: Record<string, FixtureValue> }[];
  status?: 'unset' | 'ok' | 'error';
  statusMessage?: string;
}

/** The epoch time, in milliseconds, at which every fixture trace starts. */
export const BASE_MS = Date.UTC(2026, 10, 27, 8, 0, 0);

function anyValue(value: FixtureValue): Record<string, unknown> {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => anyValue(item)) } };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function keyValues(attributes: Record<string, FixtureValue> = {}): Record<string, unknown>[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: anyValue(value) }));
}

function nanos(ms: number): string {
  return (BigInt(BASE_MS + ms) * 1_000_000n).toString();
}

const STATUS_CODE = { unset: 0, ok: 1, error: 2 } as const;

/** One OTLP span in JSON form. */
export function otlpSpan(span: FixtureSpan): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: 1,
    startTimeUnixNano: nanos(span.startMs ?? 0),
    endTimeUnixNano: nanos(span.endMs ?? (span.startMs ?? 0) + 10),
    attributes: keyValues(span.attributes),
    droppedAttributesCount: 0,
    events: (span.events ?? []).map((event) => ({
      timeUnixNano: nanos(event.atMs ?? span.startMs ?? 0),
      name: event.name,
      attributes: keyValues(event.attributes),
      droppedAttributesCount: 0,
    })),
    droppedEventsCount: 0,
    status: {
      code: STATUS_CODE[span.status ?? 'ok'],
      ...(span.statusMessage === undefined ? {} : { message: span.statusMessage }),
    },
    links: [],
    droppedLinksCount: 0,
  };
}

/** A whole trace request with the resource of pi-code-review. */
export function traceRequest(spans: FixtureSpan[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: keyValues({ 'service.name': 'pi-code-review', 'service.version': '0.2.0' }),
          droppedAttributesCount: 0,
        },
        scopeSpans: [
          { scope: { name: 'pi-code-review', version: '0.2.0' }, spans: spans.map((span) => otlpSpan(span)) },
        ],
      },
    ],
  };
}

let counter = 0;
/** A new hex ID of `length` characters. */
export function hexId(length: 16 | 32): string {
  counter += 1;
  return counter.toString(16).padStart(length, '0').replace(/^0/, 'a');
}

/** The spans of a small review run: the root, one step, one agent run, two
 * model requests, and one tool call. */
export function reviewTrace(
  traceId = hexId(32),
  options: { projectId?: string; mrIid?: string; findings?: number; rootStatus?: 'ok' | 'error' } = {},
): { traceId: string; root: FixtureSpan; others: FixtureSpan[] } {
  const rootId = hexId(16);
  const stepId = hexId(16);
  const runId = hexId(16);
  const root: FixtureSpan = {
    traceId,
    spanId: rootId,
    name: 'picr.review',
    startMs: 0,
    endMs: 60_000,
    status: options.rootStatus ?? 'ok',
    attributes: {
      'picr.model': 'nemotron-3-ultra-550b-a55b',
      'picr.language': 'zh-TW',
      'picr.source.host': 'gitlab',
      'picr.source.projectId': options.projectId ?? '10',
      'picr.source.mergeRequestIid': options.mrIid ?? '66',
      'picr.snapshot.headSha': '4eb7381ff8f0f451c6cba66274777b53000a3a51',
      'picr.result.findings': options.findings ?? 54,
    },
  };
  const others: FixtureSpan[] = [
    {
      traceId,
      spanId: stepId,
      parentSpanId: rootId,
      name: 'picr.step.review_agents',
      startMs: 1_000,
      endMs: 40_000,
      attributes: { 'picr.step': 'review_agents', 'picr.findings.after': 85 },
    },
    {
      traceId,
      spanId: runId,
      parentSpanId: stepId,
      name: 'picr.agent_run',
      startMs: 1_000,
      endMs: 39_000,
      attributes: {
        'picr.agent.kind': 'review',
        'picr.focus': 'logic correctness',
        'picr.try': 1,
        'picr.prompt.system': 'You are an automated code reviewer.',
        'picr.prompt.user': 'Review this change.',
      },
      events: [
        {
          name: 'picr.response',
          atMs: 20_000,
          attributes: { 'picr.response.text': '', 'picr.response.tool_calls': ['get_file_content'] },
        },
      ],
    },
    modelRequest(traceId, runId, 1_000, 120, 842),
    {
      traceId,
      spanId: hexId(16),
      parentSpanId: runId,
      name: 'picr.tool_call',
      startMs: 20_000,
      endMs: 20_300,
      attributes: {
        'picr.tool.name': 'get_file_content',
        'picr.tool.path': 'src/a.ts',
        'picr.tool.result': '   1 | export const a = 1;',
        'picr.tool.error': false,
      },
    },
    modelRequest(traceId, runId, 21_000, 300, 1_101),
  ];
  return { traceId, root, others };
}

/** A `picr.model_request` span with its usage. */
export function modelRequest(
  traceId: string,
  parentSpanId: string,
  startMs: number,
  input: number,
  output: number,
  spanId = hexId(16),
): FixtureSpan {
  return {
    traceId,
    spanId,
    parentSpanId,
    name: 'picr.model_request',
    startMs,
    endMs: startMs + 15_000,
    attributes: {
      provider: 'openai',
      model: 'nemotron-3-ultra-550b-a55b',
      stop: 'toolUse',
      'usage.input': input,
      'usage.output': output,
      'usage.cache_read': 0,
      'cost.total': 0.25,
    },
  };
}

/** The spans of a publish run: the root and one host request. */
export function publishTrace(traceId = hexId(32)): { traceId: string; root: FixtureSpan; others: FixtureSpan[] } {
  const rootId = hexId(16);
  return {
    traceId,
    root: { traceId, spanId: rootId, name: 'picr.publish', startMs: 0, endMs: 5_000 },
    others: [
      {
        traceId,
        spanId: hexId(16),
        parentSpanId: rootId,
        name: 'picr.host_request',
        attributes: { 'http.request.method': 'GET', 'url.path': '/api/v4/projects/10/merge_requests/66' },
      },
    ],
  };
}
