// The data of the UI and the pure logic of the timeline: the span tree and the
// time scale (`add-review-trace-server` design, Decision 7). No DOM here, so
// `node:test` can test it.

export interface TextRef {
  $text: number;
  length: number;
}

export type AttrValue = string | number | boolean | null | AttrValue[] | TextRef;
export type Attrs = Record<string, AttrValue>;

export interface Run {
  traceId: string;
  state: 'running' | 'done' | 'error' | string;
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

export interface SpanEvent {
  name: string;
  timeNs: string;
  attrs: Attrs;
}

export interface Span {
  spanId: string;
  parentId: string | null;
  name: string;
  startNs: string;
  endNs: string;
  status: 'ok' | 'error' | 'unset' | string;
  statusMessage: string | null;
  attrs: Attrs;
  events: SpanEvent[];
}

export interface TreeNode {
  span: Span;
  depth: number;
  children: TreeNode[];
}

export function isTextRef(value: unknown): value is TextRef {
  return typeof value === 'object' && value !== null && typeof (value as TextRef).$text === 'number';
}

/** Nanoseconds as a decimal string to milliseconds, with the fraction kept. */
export function nsToMs(ns: string): number {
  const value = BigInt(ns);
  return Number(value / 1_000_000n) + Number(value % 1_000_000n) / 1_000_000;
}

/** The spans as a tree, children in start order. A span whose parent has not
 * arrived is a top-level node, so a run in progress still shows all its spans. */
export function buildTree(spans: readonly Span[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const span of spans) byId.set(span.spanId, { span, depth: 0, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.span.parentId === null ? undefined : byId.get(node.span.parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  const byStart = (a: TreeNode, b: TreeNode) => nsToMs(a.span.startNs) - nsToMs(b.span.startNs);
  const setDepth = (nodes: TreeNode[], depth: number) => {
    nodes.sort(byStart);
    for (const node of nodes) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** The time scale of a run: the root span when it exists, else the first start
 * and the last end of all spans. */
export function timeScale(spans: readonly Span[]): { startMs: number; endMs: number } {
  const root = spans.find((span) => span.parentId === null && span.name === 'picr.review');
  if (root !== undefined) return { startMs: nsToMs(root.startNs), endMs: nsToMs(root.endNs) };
  if (spans.length === 0) return { startMs: 0, endMs: 1 };
  return {
    startMs: Math.min(...spans.map((span) => nsToMs(span.startNs))),
    endMs: Math.max(...spans.map((span) => nsToMs(span.endNs))),
  };
}

/** Where a span's bar starts and how wide it is, as percentages of the scale.
 * A bar is at least 0.3% wide, so a short span stays visible. */
export function barPosition(span: Span, scale: { startMs: number; endMs: number }): { left: number; width: number } {
  const total = Math.max(scale.endMs - scale.startMs, 1);
  const left = ((nsToMs(span.startNs) - scale.startMs) / total) * 100;
  const width = ((nsToMs(span.endNs) - nsToMs(span.startNs)) / total) * 100;
  const clampedLeft = Math.min(Math.max(left, 0), 99.7);
  return { left: clampedLeft, width: Math.min(Math.max(width, 0.3), 100 - clampedLeft) };
}

/** The visible rows of the tree: a node's children show only when it is expanded. */
export function visibleRows(roots: readonly TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const rows: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      rows.push(node);
      if (expanded.has(node.span.spanId)) walk(node.children);
    }
  };
  walk(roots);
  return rows;
}

/** The spans that start expanded: the root and the steps, by name, so a run
 * whose root has not arrived opens the same way. */
export function defaultExpanded(roots: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      const { name } = node.span;
      if ((name === 'picr.review' || name.startsWith('picr.step.')) && node.children.length > 0)
        ids.add(node.span.spanId);
      walk(node.children);
    }
  };
  walk(roots);
  return ids;
}

/** A short label for a span row. */
export function spanLabel(span: Span): string {
  const a = span.attrs;
  const str = (key: string) => (typeof a[key] === 'string' ? (a[key] as string) : undefined);
  switch (span.name) {
    case 'picr.review':
      return 'review';
    case 'picr.agent_run': {
      const target = str('picr.focus') ?? str('picr.file') ?? '';
      const batch = typeof a['picr.batch'] === 'number' ? ` · batch ${a['picr.batch']}` : '';
      const attempt = typeof a['picr.try'] === 'number' && a['picr.try'] > 1 ? ` · try ${a['picr.try']}` : '';
      return `${str('picr.agent.kind') ?? 'agent'}${target === '' ? '' : `: ${target}`}${batch}${attempt}`;
    }
    case 'picr.model_request':
      return `model · ${a['usage.output'] ?? 0} out · ${str('stop') ?? ''}`;
    case 'picr.tool_call':
      return `${str('picr.tool.name') ?? 'tool'}${str('picr.tool.path') ? ` ${str('picr.tool.path')}` : ''}`;
    case 'picr.host_request':
      return `${str('http.request.method') ?? ''} ${str('url.path') ?? ''} → ${a['http.response.status_code'] ?? ''}`;
    default:
      return span.name.startsWith('picr.step.') ? span.name.slice('picr.step.'.length) : span.name;
  }
}

/** The error messages of the failed agent runs, the same message counted once,
 * most frequent first. A run that failed shows its causes this way. */
export function agentRunErrors(spans: readonly Span[]): { message: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const span of spans) {
    if (span.name !== 'picr.agent_run' || span.status !== 'error') continue;
    const message = span.statusMessage ?? '（沒有錯誤訊息）';
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

/** A duration for people: `850 ms`, `12.4 s`, or `3 min 05 s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')} s`;
}

/** The pages of the UI and their hash addresses. */
export type Route =
  { page: 'runs' } | { page: 'run'; traceId: string } | { page: 'agent'; traceId: string; spanId: string };

export function parseRoute(hash: string): Route {
  const run = /^#run-([0-9a-f]{32})$/.exec(hash);
  if (run) return { page: 'run', traceId: run[1]! };
  const agent = /^#agent-([0-9a-f]{32})-([0-9a-f]{16})$/.exec(hash);
  if (agent) return { page: 'agent', traceId: agent[1]!, spanId: agent[2]! };
  return { page: 'runs' };
}

export function routeHash(route: Route): string {
  if (route.page === 'run') return `#run-${route.traceId}`;
  if (route.page === 'agent') return `#agent-${route.traceId}-${route.spanId}`;
  return '#runs';
}
