# web

## Purpose

The web UI that the UI server serves at `/`: the run list, the run timeline, and the agent run page. It reads only the read API.

## Contents

- `index.html`: the page entry.
- `src/main.tsx`: the hash router.
- `src/RunsPage.tsx`, `src/RunPage.tsx`, `src/AgentPage.tsx`: the three pages.
- `src/model.ts`: the data types and the pure logic of the timeline (tree, time scale, routes, error grouping).
- `src/api.ts`: the client of the read API.
- `src/styles.css`: the styles, with light and dark themes.

## Capabilities

- `run-viewer`: `openspec/specs/run-viewer/spec.md`
