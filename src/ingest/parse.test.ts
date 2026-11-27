import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_MS, reviewTrace, traceRequest } from '../testing/fixtures.ts';
import { nanosToMs, ParseError, parseTraceRequest } from './parse.ts';

test('a fixture request has the OTLP shape and parses', () => {
  const { root, others } = reviewTrace();
  const request = JSON.parse(JSON.stringify(traceRequest([root, ...others])));
  assert.ok(Array.isArray(request.resourceSpans[0].scopeSpans[0].spans));
  assert.equal(parseTraceRequest(request).length, 6);
});

test('each attribute value type converts to a plain value', () => {
  const body = {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'ABCDEF0123456789ABCDEF0123456789',
                spanId: '0123456789ABCDEF',
                parentSpanId: '',
                name: 'picr.review',
                startTimeUnixNano: '1795766400000000000',
                endTimeUnixNano: 1795766460000000000,
                attributes: [
                  { key: 's', value: { stringValue: 'text' } },
                  { key: 'i', value: { intValue: '54' } },
                  { key: 'i2', value: { intValue: 7 } },
                  { key: 'd', value: { doubleValue: 0.25 } },
                  { key: 'b', value: { boolValue: true } },
                  { key: 'a', value: { arrayValue: { values: [{ stringValue: 'x' }, { stringValue: 'y' }] } } },
                  { key: 'k', value: { kvlistValue: { values: [] } } },
                  { key: 'none', value: {} },
                ],
                events: [{ name: 'picr.log', timeUnixNano: '1795766400000000000', attributes: [] }],
                status: { code: 2, message: 'failed' },
              },
            ],
          },
        ],
      },
    ],
  };
  const [span] = parseTraceRequest(body);
  assert.equal(span!.traceId, 'abcdef0123456789abcdef0123456789');
  assert.equal(span!.spanId, '0123456789abcdef');
  assert.equal(span!.parentId, null);
  assert.equal(span!.endNs, '1795766460000000000');
  assert.deepEqual(span!.attrs, {
    s: 'text',
    i: 54,
    i2: 7,
    d: 0.25,
    b: true,
    a: ['x', 'y'],
    k: '{"values":[]}',
    none: null,
  });
  assert.equal(span!.status, 'error');
  assert.equal(span!.statusMessage, 'failed');
  assert.equal(span!.events[0]!.name, 'picr.log');
});

test('decimal nanosecond times keep their precision', () => {
  const [span] = parseTraceRequest(JSON.parse(JSON.stringify(traceRequest([reviewTrace().root]))));
  assert.equal(nanosToMs(span!.startNs), BASE_MS);
});

test('a wrong shape gives a ParseError', () => {
  assert.throws(() => parseTraceRequest('x'), ParseError);
  assert.throws(() => parseTraceRequest({}), ParseError);
  assert.throws(
    () => parseTraceRequest({ resourceSpans: [{ scopeSpans: [{ spans: [{ spanId: 'x' }] }] }] }),
    ParseError,
  );
  assert.throws(
    () =>
      parseTraceRequest({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'a'.repeat(32),
                    spanId: 'b'.repeat(16),
                    name: 'x',
                    startTimeUnixNano: 'soon',
                    endTimeUnixNano: '1',
                  },
                ],
              },
            ],
          },
        ],
      }),
    /startTimeUnixNano/,
  );
  assert.deepEqual(parseTraceRequest({ resourceSpans: [] }), []);
});
