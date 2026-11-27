// Sends example review traces to a running service, for a check of the UI by
// hand (tasks 7.2 to 7.4). The data is made up and marked as an example.
// Run with: npx tsx src/testing/seed.ts http://127.0.0.1:14318
import { hexId, traceRequest, type FixtureSpan } from './fixtures.ts';

const endpoint = (process.argv[2] ?? 'http://127.0.0.1:4318').replace(/\/+$/, '');
const now = Date.now();

function fileContent(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `${String(i + 1).padStart(4)} | public void Method${i}() { /* example */ }`,
  ).join('\n');
}

/** One example review with 2 steps of agents, a retry, a blocked tool call, and long texts. */
function exampleReview(startOffsetMs: number, mrIid: string, complete: boolean): FixtureSpan[] {
  const traceId = hexId(32);
  const rootId = hexId(16);
  const spans: FixtureSpan[] = [];
  const at = (ms: number) => startOffsetMs + ms;
  const step = (name: string, start: number, end: number, before?: number, after?: number) => {
    const spanId = hexId(16);
    spans.push({
      traceId,
      spanId,
      parentSpanId: rootId,
      name: `picr.step.${name}`,
      startMs: at(start),
      endMs: at(end),
      attributes: {
        'picr.step': name,
        ...(before === undefined ? {} : { 'picr.findings.before': before }),
        ...(after === undefined ? {} : { 'picr.findings.after': after }),
      },
    });
    return spanId;
  };
  const agent = (
    parent: string,
    start: number,
    end: number,
    attrs: Record<string, string | number>,
    opts: { fail?: boolean; tools?: { path: string; blocked?: boolean }[] } = {},
  ) => {
    const spanId = hexId(16);
    const tools = opts.tools ?? [];
    spans.push({
      traceId,
      spanId,
      parentSpanId: parent,
      name: 'picr.agent_run',
      startMs: at(start),
      endMs: at(end),
      status: opts.fail ? 'error' : 'ok',
      ...(opts.fail ? { statusMessage: 'The agent run failed (stopReason: error): Request timed out.' } : {}),
      attributes: {
        ...attrs,
        'picr.max_tokens': 32000,
        'picr.prompt.system':
          'You are an automated code reviewer for a single code change. (example)\n\n' + 'Rules… '.repeat(300),
        'picr.prompt.user': '## Diffs (example)\n' + fileContent(3_000).slice(0, 100_000),
        'picr.prompt.user.truncated': true,
        'picr.prompt.user.length': 182_406,
      },
      events: [
        ...tools.map((tool, i) => ({
          name: 'picr.response',
          atMs: at(start + 4_000 + i * 6_000),
          attributes: {
            'picr.response.text': '',
            'picr.response.tool_calls': ['get_file_content'],
            'picr.response.stop_reason': 'toolUse',
          },
        })),
        ...(opts.fail
          ? []
          : [
              {
                name: 'picr.response',
                atMs: at(end - 200),
                attributes: {
                  'picr.response.text': '檢查完成，回報 2 個問題。(example)',
                  'picr.response.tool_calls': ['submit_review'],
                  'picr.response.stop_reason': 'toolUse',
                },
              },
            ]),
      ],
    });
    tools.forEach((tool, i) => {
      spans.push({
        traceId,
        spanId: hexId(16),
        parentSpanId: spanId,
        name: 'picr.model_request',
        startMs: at(start + i * 6_000),
        endMs: at(start + 4_000 + i * 6_000),
        attributes: {
          provider: 'openai',
          model: 'example-model',
          stop: 'toolUse',
          'usage.input': 7_400 + i * 900,
          'usage.output': 800 + i * 50,
          'usage.cache_read': 0,
          'cost.total': 0,
        },
      });
      spans.push({
        traceId,
        spanId: hexId(16),
        parentSpanId: spanId,
        name: 'picr.tool_call',
        startMs: at(start + 4_050 + i * 6_000),
        endMs: at(start + 4_400 + i * 6_000),
        status: tool.blocked ? 'error' : 'ok',
        attributes: {
          'picr.tool.name': 'get_file_content',
          'picr.tool.path': tool.path,
          'picr.tool.result': tool.blocked ? `"${tool.path}" is not a file this change touched.` : fileContent(400),
          'picr.tool.error': tool.blocked === true,
        },
      });
    });
    if (!opts.fail) {
      spans.push({
        traceId,
        spanId: hexId(16),
        parentSpanId: spanId,
        name: 'picr.model_request',
        startMs: at(end - 4_000),
        endMs: at(end - 200),
        attributes: {
          provider: 'openai',
          model: 'example-model',
          stop: 'toolUse',
          'usage.input': 9_100,
          'usage.output': 1_250,
          'usage.cache_read': 0,
          'cost.total': 0,
        },
      });
    }
    return spanId;
  };

  spans.push({
    traceId,
    spanId: hexId(16),
    parentSpanId: rootId,
    name: 'picr.step.read_change',
    startMs: at(0),
    endMs: at(900),
    attributes: { 'picr.step': 'read_change' },
  });
  for (let i = 0; i < 3; i += 1) {
    spans.push({
      traceId,
      spanId: hexId(16),
      parentSpanId: rootId,
      name: 'picr.host_request',
      startMs: at(100 + i * 250),
      endMs: at(300 + i * 250),
      attributes: {
        'http.request.method': 'GET',
        'url.path': `/api/v4/projects/10/merge_requests/${mrIid}${['', '/diffs', '/discussions'][i]}`,
        'http.response.status_code': 200,
      },
    });
  }
  const agents = step('review_agents', 1_000, 95_000, undefined, 9);
  agent(
    agents,
    1_000,
    60_000,
    { 'picr.agent.kind': 'review', 'picr.focus': 'logic correctness', 'picr.try': 1 },
    { tools: [{ path: 'src/Service/ReportService.cs' }, { path: 'src/Repository/ReportRepository.cs' }] },
  );
  agent(
    agents,
    1_000,
    30_000,
    { 'picr.agent.kind': 'review', 'picr.focus': 'security', 'picr.try': 1 },
    { fail: true },
  );
  agent(
    agents,
    32_000,
    80_000,
    { 'picr.agent.kind': 'review', 'picr.focus': 'security', 'picr.try': 2 },
    { tools: [{ path: 'src/DatabaseConfig.cs', blocked: true }] },
  );
  agent(
    agents,
    1_000,
    95_000,
    { 'picr.agent.kind': 'review', 'picr.focus': 'resources and concurrency', 'picr.try': 1 },
    {
      tools: [
        { path: 'src/Service/ReportService.cs' },
        { path: 'src/Tool/DatabaseExtensions.cs', blocked: true },
        { path: 'src/Service/ReportService.cs' },
      ],
    },
  );
  if (complete) {
    const dedup = step('deduplication', 95_500, 101_000, 9, 7);
    agent(dedup, 95_500, 101_000, { 'picr.agent.kind': 'deduplication', 'picr.try': 1 });
    const verify = step('verification', 101_000, 140_000, 7, 5);
    agent(
      verify,
      101_000,
      140_000,
      { 'picr.agent.kind': 'verification', 'picr.file': 'src/Service/ReportService.cs', 'picr.try': 1 },
      { tools: [{ path: 'src/Service/ReportService.cs' }] },
    );
    spans.push({
      traceId,
      spanId: rootId,
      name: 'picr.review',
      startMs: at(0),
      endMs: at(141_000),
      attributes: {
        'picr.model': 'example-model',
        'picr.language': 'zh-TW',
        'picr.source.host': 'gitlab',
        'picr.source.projectId': '10',
        'picr.source.mergeRequestIid': mrIid,
        'picr.snapshot.headSha': '4eb7381ff8f0f451c6cba66274777b53000a3a51',
        'picr.result.findings': 5,
      },
      events: [
        {
          name: 'picr.finding.dropped',
          atMs: at(95_100),
          attributes: {
            'picr.file': 'src/Repository/DashboardLayoutRepository.cs',
            'picr.line': 16,
            'picr.reason': 'line_not_in_diff',
          },
        },
      ],
    });
  }
  return spans;
}

async function send(spans: FixtureSpan[]): Promise<void> {
  const response = await fetch(`${endpoint}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(traceRequest(spans)),
  });
  console.log(response.status, await response.text());
}

// The fixtures count milliseconds from a fixed base, so shift them to now.
const BASE_TO_NOW = now - Date.UTC(2026, 10, 27, 8, 0, 0);
const shift = (spans: FixtureSpan[], ms: number) =>
  spans.map((span) => ({
    ...span,
    startMs: (span.startMs ?? 0) + ms,
    endMs: (span.endMs ?? 0) + ms,
    events: span.events?.map((event) => ({ ...event, atMs: (event.atMs ?? 0) + ms })),
  }));
await send(shift(exampleReview(0, '66', true), BASE_TO_NOW - 3_600_000));
await send(shift(exampleReview(0, '67', true), BASE_TO_NOW - 600_000));
await send(shift(exampleReview(0, '68', false), BASE_TO_NOW - 60_000));
