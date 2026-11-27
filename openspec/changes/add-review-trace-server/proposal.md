## Why

The `review` command of pi-code-review (`picr`) sends one OpenTelemetry trace for each run (PR #79 of pi-code-review). No system receives these traces today. The team cannot see how long a review took, which files an agent read, what the model answered, or which findings a step dropped. This change builds the first version of the server that receives the traces of `review` and shows them in a web UI. See `docs/design.md`.

## What Changes

- A new Node service receives OTLP/HTTP JSON traces at `POST /v1/traces` on port `4318`, with no authentication.
- The service stores the traces of `review` in SQLite. It drops the traces of `publish`.
- The service keeps one record for each `review` run: the project, the merge request, the head commit, the model, the state, the times, the number of findings, the token counts, and the cost.
- The service stores each long text (a prompt, a response, or a file content) apart from the spans, compressed.
- The service marks a run as failed when no span arrives for 30 minutes and its root span is missing.
- The service deletes the data of a run after 90 days. The number of days is a setting.
- A read API on port `8080` returns the list of runs, one run, the spans of a run, and one long text.
- A web UI on port `8080` shows the list of runs, the timeline of one run, and the details of one agent run. The UI has no login.
- The repository gets the deployment instructions for a VM, including the GitLab CI/CD variable `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Capabilities

### New Capabilities

- `trace-ingest`: receiving OTLP traces, dropping the traces of `publish`, storing spans, events, and long texts, keeping the record of each run, marking stale runs, and deleting old data.
- `run-query-api`: the read API for runs, spans, and long texts.
- `run-viewer`: the web UI: the run list, the run timeline, and the agent run details.

### Modified Capabilities

(none)

## Impact

- New code in this repository: a Node 24 service in TypeScript, a SQLite database, and a React web UI built with Vite.
- New dependencies: an HTTP framework, a SQLite driver, React, and Vite.
- Deployment: one VM in the same network as GitLab, ports `4318` and `8080`. The GitLab instance or group gets the CI/CD variable `OTEL_EXPORTER_OTLP_ENDPOINT=http://<VM>:4318`.
- pi-code-review does not change.
- Not in this change: the traces of `publish`, the finding funnel, the log page, the comparison of the runs of one merge request, and authentication.
