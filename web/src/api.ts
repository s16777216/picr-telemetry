import type { Run, Span } from './model.ts';

// The client of the read API. The UI reads nothing else.

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 404 ? 'not_found' : `HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface RunFilters {
  project?: string;
  mr?: string;
  state?: string;
  before?: number;
  limit?: number;
}

export async function listRuns(filters: RunFilters): Promise<Run[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return (await getJson<{ runs: Run[] }>(`/api/runs?${params}`)).runs;
}

export function getRun(traceId: string): Promise<Run> {
  return getJson<Run>(`/api/runs/${traceId}`);
}

export async function getSpans(traceId: string): Promise<Span[]> {
  return (await getJson<{ spans: Span[] }>(`/api/runs/${traceId}/spans`)).spans;
}

export async function getText(id: number): Promise<string> {
  const response = await fetch(`/api/texts/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
