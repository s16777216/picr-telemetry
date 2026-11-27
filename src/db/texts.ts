import { gunzipSync, gzipSync } from 'node:zlib';
import type { Db } from './database.ts';

/** A string longer than this many characters is stored apart from its span
 * (`add-review-trace-server` design, Decision 4). */
export const TEXT_LIMIT = 4096;

/** What a span keeps in place of a long text. */
export interface TextRef {
  $text: number;
  length: number;
}

export type AttrValue = string | number | boolean | null | AttrValue[] | TextRef;
export type Attrs = Record<string, AttrValue>;

export function isTextRef(value: unknown): value is TextRef {
  return typeof value === 'object' && value !== null && typeof (value as TextRef).$text === 'number';
}

/** Moves each string over `TEXT_LIMIT` characters into `texts`, compressed,
 * and returns the attributes with a reference in its place. */
export function storeLongTexts(db: Db, traceId: string, spanId: string, attrs: Attrs): Attrs {
  const insert = db.prepare('INSERT INTO texts (trace_id, span_id, gzip, length) VALUES (?, ?, ?, ?)');
  const result: Attrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string' && value.length > TEXT_LIMIT) {
      const info = insert.run(traceId, spanId, gzipSync(Buffer.from(value, 'utf8')), value.length);
      result[key] = { $text: Number(info.lastInsertRowid), length: value.length };
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Deletes the long texts of one span, before the span is stored again. */
export function deleteSpanTexts(db: Db, traceId: string, spanId: string): void {
  db.prepare('DELETE FROM texts WHERE trace_id = ? AND span_id = ?').run(traceId, spanId);
}

/** The full text of a reference, or `undefined` for an unknown reference. */
export function readText(db: Db, id: number): string | undefined {
  const row = db.prepare('SELECT gzip FROM texts WHERE id = ?').get(id) as { gzip: Buffer } | undefined;
  return row === undefined ? undefined : gunzipSync(row.gzip).toString('utf8');
}
