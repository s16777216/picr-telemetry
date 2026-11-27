## Purpose

Lets a team member see the stored review runs in a browser: the list of runs, where the time of one run went, and what each agent read and answered.

## Requirements

### Requirement: Serve the web UI on the UI port
The service SHALL serve the web UI at `/` on the UI port. The web UI MUST NOT require a login.

#### Scenario: Open the UI
- **WHEN** a person opens `http://<VM>:8080/` in a browser
- **THEN** the browser shows the run list with no login page

### Requirement: Show the list of runs
The run list SHALL show one row for each run, newest first. Each row SHALL show the start time, the project ID, the merge request IID, the model, the number of findings, the input and output token sums, the duration, and the state. The run list SHALL let a person filter by project, merge request, and state, and SHALL let a person load older runs. The run list SHALL show a run in the state `running`.

#### Scenario: A run in progress
- **WHEN** a review sends its first spans and its root span has not arrived
- **THEN** the run list shows a row for the run with the state `running`

#### Scenario: Filter by merge request
- **WHEN** a person sets the project filter to `10` and the merge request filter to `66`
- **THEN** the run list shows only the runs of project `10` and merge request `66`

### Requirement: Show the timeline of a run
The run page SHALL show the spans of the run as a timeline: the steps under the root span, the agent runs under each step, and the model requests and tool calls under each agent run. Each bar SHALL start and end at the times of its span on one time scale. The page SHALL mark each span with the status `error`. A person SHALL be able to expand and collapse each span that has children. The page SHALL show the number of findings before and after each step that has these values.

#### Scenario: Open a run
- **WHEN** a person opens a run with 6 step spans
- **THEN** the page shows the 6 steps under the root span, each with a bar on the time scale

#### Scenario: A failed agent run
- **WHEN** the run has an agent run span with the status `error`
- **THEN** the page marks that span as an error

### Requirement: Show the details of an agent run
The agent run page SHALL show the kind, the review focus or the file, the batch, the try number, the system prompt, the user prompt, each response of the model in order, and each tool call with its tool name, its path, its result, and its error state. The page SHALL load a long text only when the person opens it. The page SHALL show when a text was cut by the client and its full length.

#### Scenario: Open an agent run
- **WHEN** a person opens an agent run with 3 model responses and 2 `get_file_content` calls
- **THEN** the page shows the 3 responses in order and the 2 tool calls with their paths and results

#### Scenario: A blocked tool call
- **WHEN** an agent run has a `get_file_content` call that returned an error
- **THEN** the page shows that call as an error with its result text

#### Scenario: A text cut by the client
- **WHEN** the user prompt of an agent run has `picr.prompt.user.truncated` set to `true` and `picr.prompt.user.length` set to 150,000
- **THEN** the page shows that the prompt was cut and that its full length was 150,000 characters

### Requirement: Link to a run or an agent run
Each run page and each agent run page SHALL have its own address. Opening the address SHALL show that page.

#### Scenario: Share a run
- **WHEN** a person copies the address of a run page and another person opens it
- **THEN** the browser of the other person shows the same run page
