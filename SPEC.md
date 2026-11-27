# picr-telemetry

## Purpose

Receives the OpenTelemetry traces of pi-code-review review runs, stores them in SQLite, and shows them to the team in a web UI.

## Contents

- `src/`: the service: ingest, database, read API, sweepers, and settings. See `src/SPEC.md`.
- `web/`: the React web UI. See `web/SPEC.md`.
- `deploy/`: the systemd unit.
- `docs/`: the design (`design.md`) and the deployment page (`deploy.md`).
- `openspec/`: the specs and the changes.
