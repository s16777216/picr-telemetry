## Purpose

Receives the OTLP traces that pi-code-review sends, keeps the traces of `review` runs, and drops the traces of `publish` runs. It keeps one record for each `review` run and deletes old data.

## ADDED Requirements

### Requirement: Receive OTLP traces over HTTP
The service SHALL accept OTLP/HTTP JSON trace requests at `POST /v1/traces` on the ingest port. The ingest port SHALL be `4318` unless the setting `INGEST_PORT` names another port. The service MUST NOT require authentication on this endpoint. The service SHALL accept a request body with `Content-Encoding: gzip`. The service SHALL answer a stored request with status `200` and the body `{"partialSuccess":{}}`.

#### Scenario: A valid trace request
- **WHEN** a client sends `POST /v1/traces` with `Content-Type: application/json` and a valid OTLP trace body
- **THEN** the service stores the spans and answers with status `200` and the body `{"partialSuccess":{}}`

#### Scenario: A compressed request
- **WHEN** a client sends a valid OTLP trace body compressed with gzip and the header `Content-Encoding: gzip`
- **THEN** the service stores the spans and answers with status `200`

#### Scenario: A request without credentials
- **WHEN** a client sends a valid trace request with no `Authorization` header
- **THEN** the service stores the spans

### Requirement: Reject requests that the service cannot store
The service SHALL answer status `400` for a body that is not valid JSON or not an OTLP trace request. The service SHALL answer status `415` for a content type other than `application/json`. The service SHALL answer status `413` for a body larger than 64 MB after decompression. The service SHALL answer status `503` when the database write fails. The service MUST NOT store any span of a request that it rejects.

#### Scenario: A body that is not JSON
- **WHEN** a client sends `POST /v1/traces` with the body `not json`
- **THEN** the service answers with status `400` and stores nothing

#### Scenario: A protobuf request
- **WHEN** a client sends `POST /v1/traces` with `Content-Type: application/x-protobuf`
- **THEN** the service answers with status `415` and stores nothing

#### Scenario: A body over the limit
- **WHEN** a client sends a body of 65 MB after decompression
- **THEN** the service answers with status `413` and stores nothing

#### Scenario: The database write fails
- **WHEN** the database write of a valid request fails
- **THEN** the service answers with status `503`, and the database holds no span of that request

### Requirement: Store spans once, in any order
The service SHALL store each span with its trace ID, span ID, parent span ID, name, start time, end time, status, status message, attributes, and events. The service SHALL identify a span by its trace ID and its span ID. When a span arrives again, the service SHALL replace the stored span and its events, and MUST NOT keep two copies. The service SHALL store a span whose parent span has not arrived yet.

#### Scenario: The same request arrives twice
- **WHEN** a client sends the same valid trace request two times
- **THEN** the database holds each span of the request once, with its events once

#### Scenario: A child span arrives before its parent
- **WHEN** a request holds a `picr.agent_run` span whose parent `picr.step.review_agents` span has not arrived
- **THEN** the service stores the `picr.agent_run` span with its parent span ID

### Requirement: Drop the traces of publish runs
When a request holds a root span named `picr.publish`, the service SHALL drop every span of that trace in the request, delete every stored span of that trace, and record the trace ID as ignored. The service SHALL drop every later span of an ignored trace. The service SHALL answer such a request as a stored request. The service SHALL keep an ignored trace ID for 1 day.

#### Scenario: A publish trace in one request
- **WHEN** a request holds the spans of one trace with a root span named `picr.publish`
- **THEN** the service answers with status `200` and stores no span of that trace

#### Scenario: A publish trace in two requests
- **WHEN** a first request holds a `picr.host_request` span of a trace, and a second request holds the `picr.publish` root span of the same trace
- **THEN** the database holds no span of that trace after the second request

#### Scenario: A span after the publish root
- **WHEN** a request holds a span of a trace that the service ignored 10 minutes before
- **THEN** the service stores no span of that trace

### Requirement: Store long texts apart from the spans
The service SHALL store each string attribute or event attribute longer than 4096 characters apart from its span, compressed with gzip. The span SHALL keep a reference to the text and the length of the text. Reading the text through the reference SHALL give the same characters as the text that the client sent.

#### Scenario: A long prompt
- **WHEN** a `picr.agent_run` span has a `picr.prompt.user` attribute of 50,000 characters
- **THEN** the stored span holds a reference and the length 50,000, and the text read through the reference is equal to the sent text

#### Scenario: A short attribute
- **WHEN** a span has a `picr.tool.path` attribute of 40 characters
- **THEN** the stored span holds the attribute value itself

### Requirement: Keep a record of each review run
The service SHALL create a run record for a trace when the first span of the trace arrives, with the state `running`. When the root span named `picr.review` arrives, the service SHALL set the project ID, the merge request IID, and the head commit from its `picr.source.*` and `picr.snapshot.headSha` attributes, the model from `picr.model`, the number of findings from `picr.result.findings`, and the start time and the end time from the span. The service SHALL set the state to `done`, or to `error` when the root span has the status `error`. The service SHALL keep the sum of `usage.input`, the sum of `usage.output`, and the sum of `cost.total` of the `picr.model_request` spans of the run. The service SHALL record the time of the last span that arrived for the run.

#### Scenario: A run in progress
- **WHEN** the first request of a trace holds 50 `picr.model_request` spans and no root span
- **THEN** the run record has the state `running` and the token sums of those 50 spans

#### Scenario: The root span arrives
- **WHEN** a request holds a `picr.review` span with `picr.source.projectId` `10`, `picr.source.mergeRequestIid` `66`, and `picr.result.findings` `54`
- **THEN** the run record has the project ID `10`, the merge request IID `66`, 54 findings, and the state `done`

#### Scenario: A failed review
- **WHEN** the `picr.review` root span has the status `error`
- **THEN** the run record has the state `error`

#### Scenario: A model request span arrives again
- **WHEN** the same `picr.model_request` span arrives two times
- **THEN** the token sums of the run count that span once

### Requirement: Mark stale runs as failed
The service SHALL set the state `error` for a run in the state `running` when no span of the run arrived in the last 30 minutes. The service SHALL check the runs at least once every 5 minutes.

#### Scenario: A review that stopped
- **WHEN** a run has the state `running`, and its last span arrived 31 minutes ago
- **THEN** after the next check the run has the state `error`

#### Scenario: A review that still sends spans
- **WHEN** a run has the state `running`, and its last span arrived 2 minutes ago
- **THEN** the run keeps the state `running`

### Requirement: Delete old data
The service SHALL delete each run whose last span arrived more than the retention period ago, with all its spans, events, and long texts. The retention period SHALL be 90 days unless the setting `RETENTION_DAYS` names another number of days. The service SHALL delete each ignored trace ID that is older than 1 day. The service SHALL run the deletion when it starts and then once every 24 hours.

#### Scenario: A run older than the retention period
- **WHEN** the retention period is 90 days, and the last span of a run arrived 91 days ago
- **THEN** after the next deletion the database holds no run record, span, event, or long text of that run

#### Scenario: A run inside the retention period
- **WHEN** the retention period is 90 days, and the last span of a run arrived 89 days ago
- **THEN** the deletion keeps the run and all its data
