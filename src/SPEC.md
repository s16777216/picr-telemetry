# src

## Purpose

The Node service: it receives OTLP traces on the ingest port, stores the runs of `review` in SQLite, and serves the read API and the web UI on the UI port.

## Contents

- `main.ts`: starts the two servers and the sweepers, and stops them on a signal.
- `config.ts`: reads the settings from environment variables.
- `ui.ts`: the UI server: the read API and the built web UI.
- `sweep.ts`: marks stale runs and deletes old data.
- `ingest/`: parses OTLP JSON (`parse.ts`), stores spans and run records and drops `publish` traces (`store.ts`), and serves `POST /v1/traces` (`routes.ts`).
- `db/`: opens the database and applies the schema (`database.ts`), and stores long texts apart, compressed (`texts.ts`).
- `api/`: the read API and `/healthz`.
- `testing/`: test fixtures in the shape that pi-code-review sends, and scripts that seed example data and measure ingest.

## Capabilities

- `trace-ingest`: `openspec/specs/trace-ingest/spec.md`
- `run-query-api`: `openspec/specs/run-query-api/spec.md`
