import { useCallback, useEffect, useState } from 'react';
import { listRuns, type RunFilters } from './api.ts';
import { formatDuration, routeHash, type Run } from './model.ts';
import { StateBadge } from './StateBadge.tsx';

const PAGE_SIZE = 50;
const FILTER_KEY = 'picr-telemetry.filters';

function loadFilters(): RunFilters {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as RunFilters;
  } catch {
    return {};
  }
}

function saveFilters(filters: RunFilters): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch {
    // Storage can be blocked; the filters then last only for this page.
  }
}

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The run list: newest first, with filters and "load older". */
export function RunsPage() {
  const [filters, setFilters] = useState<RunFilters>(loadFilters);
  const [draft, setDraft] = useState<RunFilters>(filters);
  const [runs, setRuns] = useState<Run[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (applied: RunFilters, before?: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listRuns({ ...applied, limit: PAGE_SIZE, ...(before === undefined ? {} : { before }) });
      setRuns((current) => (before === undefined ? page : [...current, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    } catch (cause) {
      setError(`無法讀取執行紀錄：${(cause as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  // While a run is in progress, refresh the list every 10 seconds.
  const anyRunning = runs.some((run) => run.state === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void load(filters), 10_000);
    return () => clearInterval(timer);
  }, [anyRunning, filters, load]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters(draft);
    saveFilters(draft);
  };
  const clear = () => {
    setDraft({});
    setFilters({});
    saveFilters({});
  };
  const oldest = runs.at(-1)?.startedAt;

  return (
    <section>
      <div className="page-head">
        <h1>執行紀錄</h1>
        <button type="button" className="ghost" onClick={() => void load(filters)} disabled={loading}>
          重新整理
        </button>
      </div>

      <form className="filters" onSubmit={apply}>
        <label>
          專案
          <input
            id="filter-project"
            value={draft.project ?? ''}
            onChange={(event) => setDraft({ ...draft, project: event.target.value })}
            placeholder="例如 10"
            inputMode="numeric"
          />
        </label>
        <label>
          MR
          <input
            id="filter-mr"
            value={draft.mr ?? ''}
            onChange={(event) => setDraft({ ...draft, mr: event.target.value })}
            placeholder="例如 66"
            inputMode="numeric"
          />
        </label>
        <label>
          狀態
          <select
            id="filter-state"
            value={draft.state ?? ''}
            onChange={(event) => setDraft({ ...draft, state: event.target.value })}
          >
            <option value="">全部</option>
            <option value="running">執行中</option>
            <option value="done">完成</option>
            <option value="error">失敗</option>
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit">篩選</button>
          <button type="button" className="ghost" onClick={clear}>
            清除
          </button>
        </div>
      </form>

      {error !== null && <p className="error-text">{error}</p>}

      <div className="table-wrap">
        <table className="runs">
          <thead>
            <tr>
              <th>開始時間</th>
              <th>專案</th>
              <th>MR</th>
              <th>模型</th>
              <th className="num">Findings</th>
              <th className="num">Input tokens</th>
              <th className="num">Output tokens</th>
              <th className="num">耗時</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.traceId}
                onClick={() => (window.location.hash = routeHash({ page: 'run', traceId: run.traceId }))}
              >
                <td>
                  <a href={routeHash({ page: 'run', traceId: run.traceId })}>
                    {run.startedAt === null ? '–' : dateTime.format(run.startedAt)}
                  </a>
                </td>
                <td>{run.projectId ?? '–'}</td>
                <td>{run.mrIid === null ? '–' : `!${run.mrIid}`}</td>
                <td className="model">{run.model ?? '–'}</td>
                <td className="num">{run.findings ?? '–'}</td>
                <td className="num">{run.inputTokens.toLocaleString('en-US')}</td>
                <td className="num">{run.outputTokens.toLocaleString('en-US')}</td>
                <td className="num">
                  {run.state === 'running' && run.startedAt !== null
                    ? formatDuration(run.lastSeenAt - run.startedAt)
                    : formatDuration(run.durationMs)}
                </td>
                <td>
                  <StateBadge state={run.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && runs.length === 0 && error === null && (
        <p className="empty">
          還沒有執行紀錄。在 GitLab 設定 <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> 指向這台伺服器的 port 4318 後，下一次
          review 就會出現在這裡。
        </p>
      )}
      {hasMore && oldest !== undefined && oldest !== null && (
        <button type="button" className="ghost more" onClick={() => void load(filters, oldest)} disabled={loading}>
          載入更早的紀錄
        </button>
      )}
    </section>
  );
}
