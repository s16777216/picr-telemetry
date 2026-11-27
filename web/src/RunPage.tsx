import { useEffect, useMemo, useState } from 'react';
import { getRun, getSpans } from './api.ts';
import {
  barPosition,
  buildTree,
  defaultExpanded,
  formatDuration,
  nsToMs,
  routeHash,
  spanLabel,
  timeScale,
  visibleRows,
  type Run,
  type Span,
} from './model.ts';
import { StateBadge } from './StateBadge.tsx';

/** The run page: a summary and the timeline of all spans. */
export function RunPage({ traceId }: { traceId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getRun(traceId), getSpans(traceId)])
      .then(([loadedRun, loadedSpans]) => {
        if (!active) return;
        setRun(loadedRun);
        setSpans(loadedSpans);
      })
      .catch((cause: Error) => {
        if (active)
          setError(cause.message === 'not_found' ? '找不到這筆執行紀錄，可能已超過保留期限。' : cause.message);
      });
    return () => {
      active = false;
    };
  }, [traceId]);

  if (error !== null) return <p className="error-text">{error}</p>;
  if (run === null || spans === null) return <p className="muted">載入中…</p>;
  return (
    <section>
      <p className="crumbs">
        <a href="#runs">執行紀錄</a> / review
      </p>
      <RunSummary run={run} spans={spans} />
      <Timeline traceId={traceId} spans={spans} />
    </section>
  );
}

function RunSummary({ run, spans }: { run: Run; spans: Span[] }) {
  const agentRuns = spans.filter((span) => span.name === 'picr.agent_run').length;
  const toolCalls = spans.filter((span) => span.name === 'picr.tool_call');
  const blocked = toolCalls.filter((span) => span.status === 'error').length;
  const items: [string, string][] = [
    ['專案 / MR', `${run.projectId ?? '–'} / ${run.mrIid === null ? '–' : `!${run.mrIid}`}`],
    ['模型', run.model ?? '–'],
    ['耗時', formatDuration(run.durationMs)],
    ['Findings', run.findings === null ? '–' : String(run.findings)],
    ['Tokens（in / out）', `${run.inputTokens.toLocaleString('en-US')} / ${run.outputTokens.toLocaleString('en-US')}`],
    ['Agent runs', String(agentRuns)],
    ['工具呼叫（錯誤）', `${toolCalls.length}（${blocked}）`],
    ['Head commit', run.headSha?.slice(0, 10) ?? '–'],
  ];
  return (
    <div className="summary">
      <div className="summary-title">
        <h1>review {run.mrIid === null ? '' : `!${run.mrIid}`}</h1>
        <StateBadge state={run.state} />
      </div>
      <dl className="facts">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Timeline({ traceId, spans }: { traceId: string; spans: Span[] }) {
  const roots = useMemo(() => buildTree(spans), [spans]);
  const scale = useMemo(() => timeScale(spans), [spans]);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(roots));
  const rows = visibleRows(roots, expanded);
  const total = scale.endMs - scale.startMs;

  const toggle = (spanId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h2>時間軸</h2>
        <span className="muted">
          共 {spans.length} 個 span · 總長 {formatDuration(total)}
        </span>
      </div>
      <div className="timeline-grid">
        <div className="tl-row tl-axis">
          <div className="tl-label" />
          <div className="tl-track">
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <span key={fraction} className="tick" style={{ left: `${fraction * 100}%` }}>
                {formatDuration(total * fraction)}
              </span>
            ))}
          </div>
        </div>
        {rows.map((node) => {
          const { span } = node;
          const position = barPosition(span, scale);
          const hasChildren = node.children.length > 0;
          const isOpen = expanded.has(span.spanId);
          const before = span.attrs['picr.findings.before'];
          const after = span.attrs['picr.findings.after'];
          const counts =
            typeof after === 'number' ? `${typeof before === 'number' ? `${before} → ` : '→ '}${after}` : null;
          const duration = nsToMs(span.endNs) - nsToMs(span.startNs);
          return (
            <div
              key={span.spanId}
              className={`tl-row kind-${span.name.replace(/\./g, '-')} ${span.status === 'error' ? 'is-error' : ''}`}
            >
              <div className="tl-label" style={{ paddingLeft: `${node.depth * 16}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    className="twisty"
                    aria-expanded={isOpen}
                    aria-label={isOpen ? '收合' : '展開'}
                    onClick={() => toggle(span.spanId)}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty-space" />
                )}
                {span.name === 'picr.agent_run' ? (
                  <a href={routeHash({ page: 'agent', traceId, spanId: span.spanId })}>{spanLabel(span)}</a>
                ) : (
                  <span className="label-text">{spanLabel(span)}</span>
                )}
                {counts !== null && <span className="counts">findings {counts}</span>}
                {hasChildren && !isOpen && <span className="child-count">{node.children.length}</span>}
                {span.status === 'error' && (
                  <span className="error-mark" title={span.statusMessage ?? '錯誤'}>
                    錯誤
                  </span>
                )}
              </div>
              <div className="tl-track">
                <span
                  className="bar"
                  style={{ left: `${position.left}%`, width: `${position.width}%` }}
                  title={`${spanLabel(span)} · ${formatDuration(duration)}`}
                />
                {/* A bar that ends near the right edge gets its time before its start. */}
                <span
                  className={`bar-time ${position.left + position.width > 85 ? 'before' : ''}`}
                  style={{
                    left:
                      position.left + position.width > 85
                        ? `calc(${position.left}% - 6px)`
                        : `calc(${position.left + position.width}% + 4px)`,
                  }}
                >
                  {formatDuration(duration)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
