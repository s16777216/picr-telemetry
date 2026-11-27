import { gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/database.ts';
import { ParseError, parseTraceRequest } from './parse.ts';
import { storeSpans } from './store.ts';

/** The largest body that the service accepts, after decompression. */
export const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** The answer to a stored request, as OTLP/HTTP defines it. */
const ACCEPTED = { partialSuccess: {} };

export interface IngestOptions {
  /** The time of arrival, for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/** The ingest server: `POST /v1/traces` with OTLP/HTTP JSON, gzip or plain
 * (`add-review-trace-server` design, Decisions 1 and 3). Fastify answers `415`
 * for any other content type and `413` for a raw body over the limit. */
export function buildIngestServer(db: Db, options: IngestOptions = {}): FastifyInstance {
  const now = options.now ?? Date.now;
  const app = Fastify({ bodyLimit: MAX_BODY_BYTES });

  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.post('/v1/traces', async (request, reply) => {
    let raw = request.body as Buffer;
    if ((request.headers['content-encoding'] ?? '').toLowerCase() === 'gzip') {
      try {
        raw = gunzipSync(raw, { maxOutputLength: MAX_BODY_BYTES });
      } catch (error) {
        const tooLarge = (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
        return reply
          .code(tooLarge ? 413 : 400)
          .send({ message: tooLarge ? 'The body is larger than 64 MB.' : 'The gzip body cannot be read.' });
      }
    }

    let spans;
    try {
      spans = parseTraceRequest(JSON.parse(raw.toString('utf8')));
    } catch (error) {
      const message = error instanceof ParseError ? error.message : 'The body is not valid JSON.';
      return reply.code(400).send({ message });
    }

    try {
      storeSpans(db, spans, now());
    } catch (error) {
      request.log.error({ err: error }, 'could not store the spans');
      return reply.code(503).send({ message: 'The service cannot store the spans now. Try again later.' });
    }
    return reply.code(200).send(ACCEPTED);
  });

  return app;
}
