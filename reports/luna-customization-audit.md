# Luna customization audit — October 15, 2026

Reviewed the Customize UI, authenticated Pages API, Durable Object relay, R2 attachment lifecycle, GitHub workflow, Codex runner, credentials, trace upload, visual preview, Git push verification, and deployment reporting.

## Fixed

| Issue | Result |
| --- | --- |
| The server generated the task ID after submission, so a lost response could strand a running request. | The browser saves an ID before upload. The API preserves it and the relay deduplicates identical requests using their prompt and file hashes. |
| Polling could stop with disabled controls and require a reload; requests in other tabs could not be followed. | Retry controls resume the saved task; busy tasks can be followed from another tab, and completed results survive reload until retention expires. |
| Submission 401 responses did not consistently trigger sign-in recovery. | Every Luna admin fetch handles 401 and preserves request recovery data. |
| Cleanup alarms could expire a newer task prematurely or replace its timeout. | Each task stores its own deadline. The single alarm schedules the next deadline or cleanup event and expires only tasks actually due. |
| R2 deletion failures were ignored and their object keys discarded. | Failed deletes retain their keys and retry. Cleanup reads fresh task state after external I/O. |
| Empty files were silently discarded and multipart bodies were parsed before checking their size. | Both API layers enforce non-empty files, count/size limits, and a streaming bound on the complete multipart request. |
| Runner sessions could replace each other and public callers could retain unauthenticated WebSockets. | The upgrade requires a private authentication protocol value. Only one runner can claim a task. Malformed messages are rejected and secrets are compared in constant time. |
| Results were sent immediately before closing the socket, without durable acknowledgment. | Terminal updates carry an ID, receive an acknowledgment after storage, and can be safely retransmitted. |
| The active Codex process was not stopped on disconnect because the “finished” flag was set at the start. | Separate started/finished state, bounded execution, and process-group termination stop Codex and its tools when the connection ends. |
| Environment setup failures had no immediate relay update; the runner depended on the host Node version. | The workflow selects Node.js 22 and reports setup failures/interruption. Startup and execution deadlines respect the workflow budget. |
| A trace/credential/verification failure could label an already applied change as simply failed. | Verified pushes retain their commit and pushed status with a warning; interrupted editing reports uncertainty. |
| Newly refreshed credentials were not known to the trace redactor when the trace was uploaded. | Credentials are saved first, and the trace receives a second redaction pass before upload. Partial attachment downloads are removed on failure. |
| Visual previews could capture a loading screen after a fixed 700 ms and accept page errors. | Previews wait for content and image readiness, render deferred sections, and fail on content/image/script errors. WebM and MP4 receive the correct MIME types. |
| The UI implied that pushing guaranteed deployment; controls could overflow without the external CSS reset. | Copy distinguishes a push from confirmed deployment, and the Luna form sizes its own controls. |

## Validation

`npm test`: 29 passing tests, including the five existing site tests. New coverage uses Playwright for the real Customize page, Miniflare for relay storage/WebSockets/R2/alarms, direct authenticated Pages handlers, and runner subprocesses with temporary Git repositories plus fake Codex/AWS executables. Tests never modify production content or push to the real repository. Desktop and mobile screenshots were inspected. Syntax checks and `git diff --check` pass.

Recent GitHub Actions history was also inspected. Run [38502105527](https://github.com/Rob-Keys/SweetHopeBakeryy-JS/actions/runs/38502105527) failed in “Run Luna” after setup succeeded; its public job log only reports exit code 1. The private S3 trace could not be retrieved because the local AWS session has expired. The exact cause of that historical failure is therefore unconfirmed. New runner diagnostics identify the failing phase without logging task text or credentials.

## Release and remaining boundaries

Publish the workflow/runner, relay Worker, and Pages assets as one coordinated rollout; avoid submitting requests until all three are updated because the WebSocket handshake now requires authentication. Verify the served Pages commit, active Worker version, and an end-to-end Luna request after rollout. Deployment results are recorded in the accompanying deployment chat.

Live KV/S3 writes and Git pushes cannot form one atomic transaction. A runner interruption can leave partial changes, so uncertain results must be checked before repeating the request. Deployment verification confirms the currently served commit; a pushed commit alone does not prove that Pages finished deploying it. A full live Codex/cloud customization was not run as part of this audit.
