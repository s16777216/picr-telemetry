import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerApi } from './api/routes.ts';
import type { Db } from './db/database.ts';

/** The UI server: the read API, `/healthz`, and the built web UI at `/`
 * (`add-review-trace-server` design, Decisions 1, 6, and 7). Without a built
 * UI in `webRoot`, `/` answers with a short note. */
export function buildUiServer(db: Db, webRoot: string | undefined): FastifyInstance {
  const app = Fastify();
  registerApi(app, db);
  if (webRoot !== undefined && existsSync(join(webRoot, 'index.html'))) {
    void app.register(fastifyStatic, { root: webRoot, prefix: '/' });
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/plain; charset=utf-8').send('The web UI is not built. Run "npm run build".'),
    );
  }
  return app;
}
