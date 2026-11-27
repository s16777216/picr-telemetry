## Context

See `proposal.md` (Why) and `docs/design.md`. The repository has only `docs/design.md`, `README.md`, and the OpenSpec setup. There is no code yet.

The client is pi-code-review (`picr`) with `export-review-traces`:

- It sends OTLP/HTTP JSON with `@opentelemetry/exporter-trace-otlp-http` 0.301.x to `<endpoint>/v1/traces`. A `BatchSpanProcessor` sends a batch about every 5 seconds, at most 512 spans in one request. The root span `picr.review` ends last.
- In OTLP JSON, `traceId` and `spanId` are hex strings, the times are nanoseconds as decimal strings, and an attribute value is one of `stringValue`, `intValue` (a decimal string), `doubleValue`, `boolValue`, or `arrayValue`.
- Each long text is at most 100,000 characters. The client already removes its own token and API key.
- A real run (MR 66, 2026-11-27) gave 850 spans in one trace.

## Goals / Non-Goals

**Goals:**

- One process that receives, stores, and serves the traces of `review`, as in the specs.
- A storage model that keeps the run list and the timeline fast, and loads a long text only when a person opens it.
- Tests that run without a network and without a browser for the service, and a build of the UI that the service serves.

**Non-Goals:**

- The traces of `publish`, the finding funnel, the log page, and the comparison of the runs of one merge request (see `docs/design.md`, v2).
- Authentication, TLS, and OTLP protobuf.
- A Docker image. The deployment is a Node process under systemd.

## Decisions

### Decision 1: One Node process with two Fastify servers

`src/main.ts` starts two Fastify instances: the ingest server on `INGEST_PORT` (default `4318`) and the UI server on `UI_PORT` (default `8080`). The two share one database module.

- Reason: two ports let the firewall open the ingest port only to the GitLab runners and the UI port only to the team network (see `docs/design.md`).
- Alternative: one port with two paths. The firewall cannot then tell the two apart.
- Fastify gives a body size limit, content-type parsers, and `inject()` for tests with no network.

### Decision 2: `better-sqlite3`, WAL mode, and one writer

`src/db/` opens the file at `DATABASE_PATH` (default `./data/picr-telemetry.sqlite`) with `journal_mode=WAL` and `synchronous=NORMAL`, and applies the schema of `docs/design.md` (`runs`, `spans`, `events`, `texts`, `ignored_traces`). A `schema_version` table and numbered migration functions in code keep later changes safe.

- One ingest request writes in one transaction. Only the ingest path and the two sweepers write.
- Alternative: `node:sqlite`, with no native build. Its stability level in Node 24 is not confirmed for this change; `better-sqlite3` is widely used, stable, and synchronous. The setup task checks that `better-sqlite3` installs on Windows and on the VM.

### Decision 3: The ingest path converts OTLP JSON into rows

`src/ingest/` has three parts:

1. `parse.ts`: checks the shape `resourceSpans[].scopeSpans[].spans[]` and converts each span to a plain record. `intValue` becomes a number. An `arrayValue` becomes an array. A nested `kvlistValue` becomes JSON text. A shape that does not match gives status `400`.
2. `store.ts`: in one transaction, drops the spans of ignored traces, handles a `picr.publish` root (delete the trace, record it as ignored), moves each long string to `texts`, upserts the spans, replaces their events, and updates the run record.
3. `routes.ts`: the Fastify route, the gzip decompression, the 64 MB limit after decompression, the status codes, and the answer `{"partialSuccess":{}}`.

The token sums must count a span once, also when it arrives again. The store reads the old values of a `picr.model_request` span before the upsert, and adds only the difference to the run.

### Decision 4: Long texts over 4096 characters go to `texts`, compressed with gzip

A string attribute or event attribute over 4096 characters is compressed with `node:zlib` `gzipSync` and stored in `texts`. The span keeps `{"$text": <id>, "length": <characters>}` in place of the value. Every `texts` row has the trace ID, so the retention deletes it with its run.

- Alternative: keep all text in `spans.attrs`. The timeline query would then read several MB for each run.
- Alternative: compress the whole `attrs` JSON. Short attributes would then need a decompression for every row of the timeline.

### Decision 5: Two sweepers on timers

`src/sweep.ts` has two functions, each tested with an injected clock:

- `markStaleRuns(now)`: every 5 minutes, sets `error` for each `running` run whose `last_seen_at` is more than 30 minutes before `now`.
- `deleteOldData(now, retentionDays)`: when the service starts and every 24 hours, deletes old runs with their spans, events, and texts, and ignored trace IDs older than 1 day. It runs `PRAGMA incremental_vacuum` after a deletion. The database uses `auto_vacuum=INCREMENTAL`, set when it is created.

### Decision 6: The read API is a thin layer over SQL

`src/api/` serves the routes of `run-query-api` on the UI server. `GET /api/runs/:traceId/spans` returns the spans with the text references as stored, so the UI decides when to load a text. `GET /api/texts/:id` decompresses one row.

### Decision 7: The UI is a React app built with Vite and served as static files

`web/` holds the React app. `vite build` writes `dist/web`, and the UI server serves it with `@fastify/static`. The UI uses hash routes: `#runs` (with the filters), `#run-<traceId>`, and `#agent-<traceId>-<spanId>`.

- The timeline computes one time scale from the root span (or the first and last span while the root is missing) and draws a bar for each span with CSS. It needs no chart library.
- The UI reads only the read API.
- Alternative: no build, plain HTML and JavaScript. The timeline tree and the agent page need components, so React is simpler to keep.

### Decision 8: Settings come from environment variables

`INGEST_PORT`, `UI_PORT`, `DATABASE_PATH`, `RETENTION_DAYS`, and `HOST` (default `0.0.0.0`). `src/config.ts` checks them at start and stops with a clear message for a value that is not valid.

### Decision 9: Tests use `node:test` and real SQLite files in a temp folder

The tests use `node:test` with `tsx`, as in pi-code-review. Each test opens a fresh database in a temp folder. The route tests use `fastify.inject()`. A fixture builder in `test/fixtures.ts` makes OTLP JSON requests with the span names and attributes of `picr`. The UI gets component tests only where the logic is not trivial (the time scale and the tree); the rest is checked by hand in a browser in the check tasks.

### Directories and local `SPEC.md` files

- `src/` (ingest, db, api, sweep, config, main): capabilities `trace-ingest` and `run-query-api`.
- `web/`: capability `run-viewer`.
- `deploy/`: the systemd unit and the deployment page.
- `openspec-sync-specs` must create a root `SPEC.md` for the repository, and `src/SPEC.md` and `web/SPEC.md` if the user approves them.

## Risks / Trade-offs

- [The source code of reviewed merge requests is readable by anyone who can reach port `8080`] → The deployment page asks for a firewall rule that limits `4318` to the GitLab runners and `8080` to the team network.
- [A request of 512 spans with many long texts takes time to compress] → One request compresses at most a few MB. A test measures a request of 512 spans with 100,000-character texts, and the task records the time.
- [Disk use is not measured yet] → The retention period is a setting. The deployment page asks to check the database size after one week.
- [The client changes a span or attribute name] → The fixture builder is the single list of the names that the service reads. A change in pi-code-review must update it.
- [Fastify, `better-sqlite3`, React, or Vite versions] → The setup task picks releases that are at least two weeks old and pins them in `package-lock.json`.

## Migration Plan

This is the first version. Deployment: install Node 24 on the VM, copy the build, start the systemd unit, open the firewall, and set the GitLab CI/CD variable. Rollback: stop the service or remove the GitLab variable; pi-code-review then sends nothing.

## Open Questions

- The backup of the database file on the VM (see `docs/design.md`). It does not change the code of this change.
