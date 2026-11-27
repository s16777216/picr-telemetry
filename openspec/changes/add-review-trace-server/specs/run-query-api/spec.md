## Purpose

Gives the web UI and other clients read access to the stored review runs: the list of runs, one run, the spans of a run, and the full long texts.

## ADDED Requirements

### Requirement: Serve the read API on the UI port
The service SHALL serve the read API under `/api` on the UI port. The UI port SHALL be `8080` unless the setting `UI_PORT` names another port. The read API MUST NOT require authentication. The read API MUST NOT change stored data.

#### Scenario: A request to the read API
- **WHEN** a client sends `GET /api/runs` to port `8080` with no credentials
- **THEN** the service answers with status `200` and a JSON body

### Requirement: List runs
`GET /api/runs` SHALL return the run records, newest start time first. The request SHALL accept the optional filters `project`, `mr`, and `state`, and the optional parameters `before` and `limit`. A filter SHALL keep only the runs with that project ID, merge request IID, or state. `before` SHALL keep only the runs that started before that time, in epoch milliseconds. `limit` SHALL default to 50 and MUST NOT be larger than 200. A run whose root span has not arrived SHALL be in the list with the fields that are known.

#### Scenario: Filter by merge request
- **WHEN** a client sends `GET /api/runs?project=10&mr=66`
- **THEN** the body holds only the runs of project `10` and merge request `66`, newest first

#### Scenario: Page through runs
- **WHEN** a client sends `GET /api/runs?limit=2`, and then `GET /api/runs?limit=2&before=<start time of the second run>`
- **THEN** the second answer holds the third and the fourth newest runs

#### Scenario: A limit over the maximum
- **WHEN** a client sends `GET /api/runs?limit=500`
- **THEN** the body holds at most 200 runs

#### Scenario: A run in progress
- **WHEN** a run has the state `running` and no root span
- **THEN** the list holds the run with its trace ID, its state, and its token sums

### Requirement: Return one run
`GET /api/runs/:traceId` SHALL return the run record of that trace. The service SHALL answer status `404` for a trace ID with no run record.

#### Scenario: A known run
- **WHEN** a client sends `GET /api/runs/<trace ID of a stored run>`
- **THEN** the body holds the run record

#### Scenario: An unknown run
- **WHEN** a client sends `GET /api/runs/0123456789abcdef0123456789abcdef` and no run has that trace ID
- **THEN** the service answers with status `404`

### Requirement: Return the spans of a run
`GET /api/runs/:traceId/spans` SHALL return every stored span of the run with its events. For a long text, the answer SHALL hold the reference and the length, and MUST NOT hold the text. The service SHALL answer status `404` for a trace ID with no run record.

#### Scenario: Spans with a long prompt
- **WHEN** a client asks for the spans of a run whose `picr.agent_run` span has a `picr.prompt.user` attribute of 50,000 characters
- **THEN** the answer holds the reference and the length 50,000 for that attribute, and not the text

### Requirement: Return one long text
`GET /api/texts/:id` SHALL return the full long text with that reference as `text/plain; charset=utf-8`. The service SHALL answer status `404` for an unknown reference.

#### Scenario: Read a long prompt
- **WHEN** a client sends `GET /api/texts/<reference of a 50,000-character prompt>`
- **THEN** the body is the full prompt of 50,000 characters

### Requirement: Report the health of the service
`GET /healthz` on the UI port SHALL answer status `200` when the service can read the database, and status `503` when it cannot.

#### Scenario: A healthy service
- **WHEN** a client sends `GET /healthz` and the database can be read
- **THEN** the service answers with status `200`
