import { useEffect, useMemo, useState } from 'react';
import { getSpans, getText } from './api.ts';
import { formatDuration, isTextRef, nsToMs, routeHash, type AttrValue, type Attrs, type Span } from './model.ts';

/** One entry of the conversation of an agent run, in time order. */
type Entry =
  | { kind: 'response'; atMs: number; attrs: Attrs }
  | { kind: 'tool'; atMs: number; span: Span }
  | { kind: 'request'; atMs: number; span: Span };

/** The agent run page: its facts, its prompts, and its conversation. */
export function AgentPage({ traceId, spanId }: { traceId: string; spanId: string }) {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSpans(traceId)
      .then((loaded) => active && setSpans(loaded))
      .catch(
        (cause: Error) => active && setError(cause.message === 'not_found' ? '找不到這筆執行紀錄。' : cause.message),
      );
    return () => {
      active = false;
    };
  }, [traceId]);

  const agent = spans?.find((span) => span.spanId === spanId);
  const entries = useMemo<Entry[]>(() => {
    if (spans === null || agent === undefined) return [];
    const children = spans.filter((span) => span.parentId === spanId);
    const list: Entry[] = [
      ...agent.events
        .filter((event) => event.name === 'picr.response')
        .map((event) => ({ kind: 'response' as const, atMs: nsToMs(event.timeNs), attrs: event.attrs })),
      ...children
        .filter((span) => span.name === 'picr.tool_call')
        .map((span) => ({ kind: 'tool' as const, atMs: nsToMs(span.startNs), span })),
      ...children
        .filter((span) => span.name === 'picr.model_request')
        .map((span) => ({ kind: 'request' as const, atMs: nsToMs(span.startNs), span })),
    ];
    // A response ends a model request, so at the same time it comes after the request.
    const order = { request: 0, response: 1, tool: 2 };
    return list.sort((a, b) => a.atMs - b.atMs || order[a.kind] - order[b.kind]);
  }, [spans, agent, spanId]);

  if (error !== null) return <p className="error-text">{error}</p>;
  if (spans === null) return <p className="muted">載入中…</p>;
  if (agent === undefined) return <p className="error-text">這筆執行紀錄裡找不到這個 agent run。</p>;

  const a = agent.attrs;
  const facts: [string, string][] = [
    ['種類', String(a['picr.agent.kind'] ?? '–')],
    ['Review focus / 檔案', String(a['picr.focus'] ?? a['picr.file'] ?? '–')],
    ['Batch', a['picr.batch'] === undefined || a['picr.batch'] === null ? '–' : String(a['picr.batch'])],
    ['第幾次嘗試', String(a['picr.try'] ?? '–')],
    ['耗時', formatDuration(nsToMs(agent.endNs) - nsToMs(agent.startNs))],
    ['狀態', agent.status === 'error' ? `錯誤：${agent.statusMessage ?? ''}` : '正常'],
  ];

  return (
    <section>
      <p className="crumbs">
        <a href="#runs">執行紀錄</a> / <a href={routeHash({ page: 'run', traceId })}>review</a> / agent run
      </p>
      <div className="summary">
        <div className="summary-title">
          <h1>
            {String(a['picr.agent.kind'] ?? 'agent')}：{String(a['picr.focus'] ?? a['picr.file'] ?? '')}
          </h1>
        </div>
        <dl className="facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2>Prompt</h2>
      <TextBlock title="System prompt" attrs={a} name="picr.prompt.system" />
      <TextBlock title="User prompt" attrs={a} name="picr.prompt.user" />

      <h2>對話（{entries.length}）</h2>
      <ol className="conversation">
        {entries.map((entry, index) => (
          <li key={index} className={`entry entry-${entry.kind}`}>
            {entry.kind === 'request' && <RequestEntry span={entry.span} />}
            {entry.kind === 'response' && <ResponseEntry attrs={entry.attrs} />}
            {entry.kind === 'tool' && <ToolEntry span={entry.span} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RequestEntry({ span }: { span: Span }) {
  const a = span.attrs;
  return (
    <div className="entry-head">
      <span className="entry-kind">模型請求</span>
      <span className="muted">
        {formatDuration(nsToMs(span.endNs) - nsToMs(span.startNs))} · in {String(a['usage.input'] ?? 0)} · out{' '}
        {String(a['usage.output'] ?? 0)} · {String(a.stop ?? '')}
      </span>
      {span.status === 'error' && <span className="error-mark">錯誤</span>}
    </div>
  );
}

function ResponseEntry({ attrs }: { attrs: Attrs }) {
  const calls = Array.isArray(attrs['picr.response.tool_calls'])
    ? (attrs['picr.response.tool_calls'] as AttrValue[])
    : [];
  return (
    <>
      <div className="entry-head">
        <span className="entry-kind">模型回覆</span>
        {calls.length > 0 && <span className="muted">呼叫：{calls.map(String).join('、')}</span>}
      </div>
      <TextBlock title="回覆文字" attrs={attrs} name="picr.response.text" open emptyNote="（沒有文字，只有工具呼叫）" />
    </>
  );
}

function ToolEntry({ span }: { span: Span }) {
  const a = span.attrs;
  const failed = span.status === 'error' || a['picr.tool.error'] === true;
  return (
    <>
      <div className="entry-head">
        <span className={`entry-kind ${failed ? 'is-error' : ''}`}>{String(a['picr.tool.name'] ?? 'tool')}</span>
        {typeof a['picr.tool.path'] === 'string' && <code>{a['picr.tool.path']}</code>}
        {failed && <span className="error-mark">錯誤</span>}
      </div>
      <TextBlock title="結果" attrs={a} name="picr.tool.result" open={failed} />
    </>
  );
}

/** A text attribute: shown at once when it is short, loaded from the API when
 * the person opens it when it is a long-text reference. A text that the client
 * cut shows its full length. */
function TextBlock({
  title,
  attrs,
  name,
  open = false,
  emptyNote,
}: {
  title: string;
  attrs: Attrs;
  name: string;
  open?: boolean;
  emptyNote?: string;
}) {
  const value = attrs[name];
  const cut = attrs[`${name}.truncated`] === true;
  const fullLength = attrs[`${name}.length`];
  const [text, setText] = useState<string | null>(typeof value === 'string' ? value : null);
  const [failed, setFailed] = useState(false);
  const length = isTextRef(value) ? value.length : typeof value === 'string' ? value.length : 0;

  const onToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && text === null && isTextRef(value)) {
      getText(value.$text)
        .then(setText)
        .catch(() => setFailed(true));
    }
  };

  if (value === undefined || value === null || (typeof value === 'string' && value === '')) {
    return emptyNote === undefined ? null : <p className="muted small">{emptyNote}</p>;
  }
  return (
    <details className="text-block" open={open && !isTextRef(value)} onToggle={onToggle}>
      <summary>
        {title}
        <span className="muted"> · {length.toLocaleString('en-US')} 字元</span>
        {cut && (
          <span className="cut-note">
            client 已截斷，原本 {typeof fullLength === 'number' ? fullLength.toLocaleString('en-US') : '?'} 字元
          </span>
        )}
      </summary>
      {failed ? <p className="error-text">無法讀取這段文字。</p> : <pre>{text ?? '載入中…'}</pre>}
    </details>
  );
}
