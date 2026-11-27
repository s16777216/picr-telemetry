const LABELS: Record<string, string> = { running: '執行中', done: '完成', error: '失敗' };

/** The state of a run as a colored pill. */
export function StateBadge({ state }: { state: string }) {
  return <span className={`badge badge-${state}`}>{LABELS[state] ?? state}</span>;
}
