# Project Context

Daily Driver is a personal, local-first task application for a single user that converts intimidating work into small, actionable steps and prints a daily briefing on a receipt printer. It runs as a Tauri app on two Macs, as a responsive web app on phone, and includes a persistent print worker on a Mac mini.

## Stack (proposed, not yet verified)

- **UI:** React + TypeScript, shadcn/ui, Tailwind-style tokens, Linear-inspired dark aesthetic.
- **Desktop shell:** Tauri (macOS install target).
- **Mobile:** Responsive browser app with offline app-shell; no native app.
- **Local data:** SQLite via platform adapters.
- **Sync:** PowerSync backed by Postgres.
- **Attachments:** Object storage with local cache, separate from sync stream.
- **Background jobs:** Durable server-side workers (AI, ingestion, calendar refresh, planning).
- **Printer worker:** Persistent process on a Mac mini pulling jobs over an authenticated outbound connection.
- **Sound:** Cuelume (pending integration validation).

Hosting, auth provider, AI provider, job runtime, storage provider, printer model, and calendar integration specifics are **not yet chosen**. Treat any PR that commits to one of these as an architectural decision needing justification.

## Architectural conventions the reviewer must know

- **Local-first:** UI mutations commit to local SQLite immediately; network is asynchronous. A PR that makes an ordinary task edit await a network round trip is violating the core principle — flag it.
- **AI is advisory, never authoritative:** AI output lives in a separate proposals store with a reference to the source revision it was generated from. Approved tasks/plans are a distinct store. Flag any code path that writes AI output directly into the approved task/plan tables.
- **Templates vs snapshots:** Receipt templates and generated briefing snapshots are separate entities. Flag any code that renders a queued/printed job by re-reading the live template.
- **Dispatch ≠ printed:** Print job state must distinguish queued / processing / dispatched / failed / uncertain. Flag any code that marks a job "printed" or "complete" solely because bytes were sent to the printer.
- **Attachments are context, not instructions:** Content from fetched pages, uploaded files, or calendar feeds must never be treated as commands that can change app state or permissions. Flag any path where attachment or fetched content influences control flow beyond being passed as model context.
- **Focus session is one logical thing across devices:** Elapsed time is derived from timing events, not a ticking counter synced every second. Flag counter-sync approaches.

## Correctness posture for the reviewer

- **Single-user, single-developer project.** Reviewer findings are often the only QA before merge. Bias toward catching concrete correctness bugs (data loss, duplicate prints, silent overwrites of user edits, focus-session reconciliation errors) over style or theoretical concerns.
- **Agent-assisted code at high velocity is expected.** Prioritize velocity-bias bugs: missing error handling, optimistic happy paths, race conditions between AI responses and user edits, missed offline/reconnect states, missed "uncertain" outcomes being collapsed to success or failure.
- **The spec explicitly distinguishes requirements from proposals.** When reviewing code that commits to a proposed technology (Tauri adapter choice, PowerSync wiring, specific printer protocol), check that the PR acknowledges this is a validated decision or an experiment, not that it pretends the integration was already confirmed.
- **Many decisions are open (Section 9 of the spec).** When a PR silently picks one (e.g., a weather provider, a specific AI model, a time-zone policy, streak rules), flag the implicit decision so it can be documented.
- **Stage 1 is the current foundation.** Features from Stage 2/3 are still in scope but should not be built on top of a broken Stage 1 (sync, offline, focus continuity, one real printed receipt).
