import type { Attrs, AttrValue } from '../db/texts.ts';

// Converts an OTLP/HTTP JSON trace request into plain span records
// (`add-review-trace-server` design, Decision 3).

export type SpanStatus = 'unset' | 'ok' | 'error';

export interface ParsedEvent {
  name: string;
  timeNs: string;
  attrs: Attrs;
}

export interface ParsedSpan {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  startNs: string;
  endNs: string;
  status: SpanStatus;
  statusMessage: string | null;
  attrs: Attrs;
  events: ParsedEvent[];
}

/** The request does not have the shape of an OTLP trace request. */
export class ParseError extends Error {}

const TRACE_ID = /^[0-9a-fA-F]{32}$/;
const SPAN_ID = /^[0-9a-fA-F]{16}$/;
const NANOS = /^\d+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ParseError(`${where} is not an array.`);
  return value;
}

/** One OTLP `AnyValue`. A nested key-value list becomes JSON text. */
function convertValue(value: unknown): AttrValue {
  if (!isObject(value)) return null;
  if ('stringValue' in value) return String(value.stringValue);
  if ('boolValue' in value) return Boolean(value.boolValue);
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('arrayValue' in value) {
    const values = isObject(value.arrayValue) ? list(value.arrayValue.values, 'arrayValue.values') : [];
    return values.map((item) => convertValue(item));
  }
  if ('kvlistValue' in value) return JSON.stringify(value.kvlistValue);
  if ('bytesValue' in value) return String(value.bytesValue);
  return null;
}

function convertAttributes(value: unknown, where: string): Attrs {
  const attrs: Attrs = {};
  for (const item of list(value, where)) {
    if (!isObject(item) || typeof item.key !== 'string') throw new ParseError(`${where} has an item with no "key".`);
    attrs[item.key] = convertValue(item.value);
  }
  return attrs;
}

function nanosOf(value: unknown, where: string): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !NANOS.test(text)) throw new ParseError(`${where} is not a time in nanoseconds.`);
  return text;
}

function statusOf(value: unknown): { status: SpanStatus; message: string | null } {
  if (!isObject(value)) return { status: 'unset', message: null };
  const code = Number(value.code ?? 0);
  const status: SpanStatus = code === 2 ? 'error' : code === 1 ? 'ok' : 'unset';
  return { status, message: typeof value.message === 'string' && value.message !== '' ? value.message : null };
}

function convertSpan(value: unknown, where: string): ParsedSpan {
  if (!isObject(value)) throw new ParseError(`${where} is not an object.`);
  const { traceId, spanId, parentSpanId, name } = value;
  if (typeof traceId !== 'string' || !TRACE_ID.test(traceId)) throw new ParseError(`${where} has no valid "traceId".`);
  if (typeof spanId !== 'string' || !SPAN_ID.test(spanId)) throw new ParseError(`${where} has no valid "spanId".`);
  if (typeof name !== 'string' || name === '') throw new ParseError(`${where} has no "name".`);
  const parent =
    typeof parentSpanId === 'string' && SPAN_ID.test(parentSpanId) && !/^0+$/.test(parentSpanId)
      ? parentSpanId.toLowerCase()
      : null;
  const { status, message } = statusOf(value.status);
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    parentId: parent,
    name,
    startNs: nanosOf(value.startTimeUnixNano, `${where}.startTimeUnixNano`),
    endNs: nanosOf(value.endTimeUnixNano, `${where}.endTimeUnixNano`),
    status,
    statusMessage: message,
    attrs: convertAttributes(value.attributes, `${where}.attributes`),
    events: list(value.events, `${where}.events`).map((event, index) => {
      const at = `${where}.events[${index}]`;
      if (!isObject(event) || typeof event.name !== 'string') throw new ParseError(`${at} has no "name".`);
      return {
        name: event.name,
        timeNs: nanosOf(event.timeUnixNano, `${at}.timeUnixNano`),
        attrs: convertAttributes(event.attributes, `${at}.attributes`),
      };
    }),
  };
}

/** Every span of an OTLP trace request. Throws `ParseError` for a wrong shape. */
export function parseTraceRequest(body: unknown): ParsedSpan[] {
  if (!isObject(body)) throw new ParseError('The body is not a JSON object.');
  if (!Array.isArray(body.resourceSpans)) throw new ParseError('The body has no "resourceSpans" array.');
  const spans: ParsedSpan[] = [];
  body.resourceSpans.forEach((resource, r) => {
    if (!isObject(resource)) throw new ParseError(`resourceSpans[${r}] is not an object.`);
    list(resource.scopeSpans, `resourceSpans[${r}].scopeSpans`).forEach((scope, s) => {
      if (!isObject(scope)) throw new ParseError(`resourceSpans[${r}].scopeSpans[${s}] is not an object.`);
      list(scope.spans, `resourceSpans[${r}].scopeSpans[${s}].spans`).forEach((span, i) => {
        spans.push(convertSpan(span, `resourceSpans[${r}].scopeSpans[${s}].spans[${i}]`));
      });
    });
  });
  return spans;
}

/** Nanoseconds as a decimal string to epoch milliseconds. */
export function nanosToMs(nanos: string): number {
  return Number(BigInt(nanos) / 1_000_000n);
}
