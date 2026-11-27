import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barPosition,
  buildTree,
  defaultExpanded,
  formatDuration,
  nsToMs,
  parseRoute,
  routeHash,
  timeScale,
  visibleRows,
  type Span,
} from './model.ts';

const BASE_NS = 1_795_766_400_000n * 1_000_000n;

function span(spanId: string, parentId: string | null, name: string, startMs: number, endMs: number): Span {
  return {
    spanId,
    parentId,
    name,
    startNs: (BASE_NS + BigInt(startMs) * 1_000_000n).toString(),
    endNs: (BASE_NS + BigInt(endMs) * 1_000_000n).toString(),
    status: 'ok',
    statusMessage: null,
    attrs: {},
    events: [],
  };
}

const SPANS: Span[] = [
  span('s2', 'r', 'picr.step.verification', 40_000, 50_000),
  span('r', null, 'picr.review', 0, 60_000),
  span('s1', 'r', 'picr.step.review_agents', 1_000, 40_000),
  span('a1', 's1', 'picr.agent_run', 1_000, 39_000),
  span('m1', 'a1', 'picr.model_request', 1_000, 16_000),
];

test('buildTree nests the spans and sorts the children by start time', () => {
  const [root, ...rest] = buildTree(SPANS);
  assert.equal(rest.length, 0);
  assert.equal(root!.span.spanId, 'r');
  assert.deepEqual(
    root!.children.map((node) => node.span.spanId),
    ['s1', 's2'],
  );
  assert.equal(root!.children[0]!.children[0]!.children[0]!.depth, 3);
});

test('a span whose parent has not arrived is a top-level node', () => {
  const roots = buildTree([span('a1', 's1', 'picr.agent_run', 0, 10), span('m1', 'a1', 'picr.model_request', 0, 5)]);
  assert.deepEqual(
    roots.map((node) => node.span.spanId),
    ['a1'],
  );
  assert.equal(roots[0]!.children[0]!.span.spanId, 'm1');
});

test('timeScale uses the root span, or the first and last spans without it', () => {
  assert.deepEqual(timeScale(SPANS), { startMs: nsToMs(SPANS[1]!.startNs), endMs: nsToMs(SPANS[1]!.endNs) });
  const withoutRoot = SPANS.filter((item) => item.spanId !== 'r');
  const scale = timeScale(withoutRoot);
  assert.equal(scale.endMs - scale.startMs, 49_000);
});

test('barPosition places a span on the scale and keeps a short span visible', () => {
  const scale = timeScale(SPANS);
  assert.deepEqual(barPosition(SPANS[0]!, scale), { left: (40 / 60) * 100, width: (10 / 60) * 100 });
  const tiny = span('t', 'a1', 'picr.tool_call', 30_000, 30_001);
  assert.equal(barPosition(tiny, scale).width, 0.3);
});

test('the root and the steps start expanded, and a collapsed node hides its children', () => {
  const roots = buildTree(SPANS);
  const expanded = defaultExpanded(roots);
  assert.deepEqual([...expanded].sort(), ['r', 's1']);
  assert.deepEqual(
    visibleRows(roots, expanded).map((node) => node.span.spanId),
    ['r', 's1', 'a1', 's2'],
  );
  expanded.add('a1');
  assert.deepEqual(
    visibleRows(roots, expanded).map((node) => node.span.spanId),
    ['r', 's1', 'a1', 'm1', 's2'],
  );
});

test('the hash routes round-trip', () => {
  const traceId = 'a'.repeat(32);
  for (const route of [
    { page: 'runs' },
    { page: 'run', traceId },
    { page: 'agent', traceId, spanId: 'b'.repeat(16) },
  ] as const) {
    assert.deepEqual(parseRoute(routeHash(route)), route);
  }
  assert.deepEqual(parseRoute('#settings'), { page: 'runs' });
});

test('formatDuration gives a short duration for people', () => {
  assert.equal(formatDuration(850), '850 ms');
  assert.equal(formatDuration(12_400), '12.4 s');
  assert.equal(formatDuration(185_000), '3 min 05 s');
  assert.equal(formatDuration(null), '–');
});

test('a run without its root opens its steps and keeps the agent runs closed', () => {
  const roots = buildTree(SPANS.filter((item) => item.spanId !== 'r'));
  assert.deepEqual([...defaultExpanded(roots)], ['s1']);
});
