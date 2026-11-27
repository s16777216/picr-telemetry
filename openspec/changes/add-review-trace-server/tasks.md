## 1. Project setup

- [x] 1.1 Add `package.json` (Node 24, ESM), `tsconfig.json`, ESLint, and Prettier, in the style of pi-code-review. Add the scripts `build`, `test`, `lint`, and `format:check`. Pick each dependency release at least two weeks old. Verify that `npm install` and an empty `npm test` pass.
- [x] 1.2 Add Fastify, `@fastify/static`, and `better-sqlite3`. Verify that `better-sqlite3` loads on Windows with a one-line script that opens an in-memory database.
- [x] 1.3 Replace the template in `openspec/VERIFY.md` with the real `build`, `test`, `lint`, and `format:check` commands. Verify that each command exists in `package.json`.

## 2. Database

- [x] 2.1 Add `src/config.ts` with `INGEST_PORT`, `UI_PORT`, `DATABASE_PATH`, `RETENTION_DAYS`, and `HOST`. Verify with tests: the defaults, and a stop with a clear message for `RETENTION_DAYS=abc`.
- [x] 2.2 Add `src/db/` with the schema, `schema_version`, WAL mode, and `auto_vacuum=INCREMENTAL`. Verify with a test that a new database has every table and index of `docs/design.md`, and that a second open does not apply the schema again.
- [x] 2.3 Add the text store: gzip for each string over 4096 characters, and the reference `{"$text": id, "length": n}`. Verify with tests for a 50,000-character text (round trip equal) and a 40-character text (kept as it is).

## 3. Ingest

- [x] 3.1 Add `src/testing/fixtures.ts` that builds OTLP JSON requests with the `picr` span names and attributes. Verify that a fixture parses with `JSON.parse` and has the shape `resourceSpans[].scopeSpans[].spans[]`.
- [x] 3.2 Add `src/ingest/parse.ts`. Verify with tests: each attribute value type, a hex trace ID, decimal nanosecond times, and status `400` for a wrong shape.
- [x] 3.3 Add `src/ingest/store.ts`: upsert of spans and events in one transaction, and the run record. Verify with tests for "The same request arrives twice", "A child span arrives before its parent", "A run in progress", "The root span arrives", "A failed review", and "A model request span arrives again".
- [x] 3.4 Drop the traces of `publish` with `ignored_traces`. Verify with tests for the three scenarios of "Drop the traces of publish runs".
- [x] 3.5 Add `src/ingest/routes.ts` with gzip, the 64 MB limit, and the status codes. Verify with `inject()` tests for each scenario of "Receive OTLP traces over HTTP" and "Reject requests that the service cannot store", including a forced database failure that stores nothing.
- [x] 3.6 Measure a request of 512 spans with 100,000-character texts. Verify that it is stored, and record the time in the notes of this file.

## 4. Sweepers

- [x] 4.1 Add `markStaleRuns(now)`. Verify with tests for "A review that stopped" and "A review that still sends spans" with an injected clock.
- [x] 4.2 Add `deleteOldData(now, retentionDays)`. Verify with tests for "A run older than the retention period" and "A run inside the retention period", and that the ignored trace IDs older than 1 day are deleted.

## 5. Read API

- [x] 5.1 Add `GET /api/runs` with the filters, `before`, and `limit`. Verify with `inject()` tests for each scenario of "List runs".
- [x] 5.2 Add `GET /api/runs/:traceId` and `GET /api/runs/:traceId/spans`. Verify with tests for a known run, an unknown run (`404`), and a long prompt that the answer gives only as a reference.
- [x] 5.3 Add `GET /api/texts/:id` and `GET /healthz`. Verify with tests for a 50,000-character text, an unknown reference (`404`), and a healthy service.

## 6. Service

- [x] 6.1 Add `src/main.ts` that starts both servers and both sweepers, and closes the database on `SIGINT` and `SIGTERM`. Verify by starting the built service and sending one fixture request with `curl` to `4318` and `GET /api/runs` to `8080`.

## 7. Web UI

- [x] 7.1 Add the Vite and React app in `web/` and serve `dist/web` at `/` on the UI server. Verify that `npm run build` writes `dist/web/index.html` and that `GET /` returns it.
- [x] 7.2 Add the run list with the filters, the paging, and the `running` state. Verify by hand in a browser with fixture data.
- [x] 7.3 Add the run timeline: the tree, the time scale, the errors, expand and collapse, and the findings before and after each step. Verify with component tests for the time scale and the tree, and by hand in a browser.
- [x] 7.4 Add the agent run page: the prompts, the responses, the tool calls, the cut texts, and the long texts loaded on open. Verify by hand in a browser with fixture data.
- [x] 7.5 Add the hash routes `#runs`, `#run-<traceId>`, and `#agent-<traceId>-<spanId>`. Verify that opening each address in a new tab shows the same page.

## 8. Deployment

- [x] 8.1 Add `deploy/picr-telemetry.service` (systemd) and `docs/deploy.md`: Node 24, the build, the environment variables, the firewall rules for `4318` and `8080`, the GitLab CI/CD variable at the instance or group level, and a check of the database size after one week. Verify that the page names each environment variable of `src/config.ts`.

## 9. Check

- [x] 9.1 Run `npm run build`, `npm test`, `npm run lint`, and `npm run format:check`. Verify that all pass.
- [x] 9.2 Start the service on this computer. Run pi-code-review `review` on a test merge request with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`, only after the user approves it. Verify in the UI that the run is in the list, the timeline has the steps and agent runs, and an agent run page shows its prompts and tool calls.
- [x] 9.3 Run `openspec-sync-specs` to create the main specs and the local `SPEC.md` files listed in the design. Ask the user to approve each `SPEC.md` first.

Order: group 1 before all others, 2 before 3 to 5, 3.1 before 3.3 to 3.6, 5 before 7, and group 9 last.

## Notes

- 3.1: the fixtures are in `src/testing/fixtures.ts`, not `test/fixtures.ts`, because every test file is under `src`.
- 3.6 result (2026-11-27, Windows, in-memory database): one request of 512 `picr.tool_call` spans, each with a 100,000-character result (39.3 MB of JSON), was stored in 1,059 ms. The 512 texts take 5.58 MB after gzip.
- 2.2: the span and event times are stored as decimal strings of nanoseconds (`start_ns TEXT`), because a nanosecond time is larger than the safe integer range of JavaScript. `texts` also has `span_id`, so a span that arrives again replaces its own texts.
- 9.2 result (2026-11-27, approved by the user): `review` of MR 66 (project 10) with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` failed after 59.9 s with `model_failed`: the model provider answered 429 (the free daily quota of the OpenRouter route was used up, and the other deployments were in cooldown). The service stored the trace: the run is in the list with the state `error`, the timeline shows `read_change`, 7 review agent runs of batch 1 with their retries, the discussion judgment step, and 25 host requests, and each failed agent run page shows its error message. The client wrote no export warning. A successful run with tool calls was checked with the example data of `src/testing/seed.ts`.
- 9.2 change: the run page now lists the distinct error messages of the failed agent runs, and the agent run page shows its error in a full-width box, because the timeline alone did not show why a run failed.
