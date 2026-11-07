# Review Standards

If a `CLAUDE.md` exists in the repo, treat it as the source of truth for code-generation conventions (formatting, module layout, naming). This file adds review-time correctness concerns on top.

## Local-first and offline

- When reviewing any task, project, plan, or focus-session mutation, verify the write path commits to local SQLite before any network call. Flag code that awaits a server response before updating local UI state.
- Verify queued operations persist across restart. Flag in-memory-only queues for AI requests, print jobs, calendar refreshes, or sync operations.
- When reviewing reconnect/sync logic, check behavior for: deleted-while-offline items, items edited on two devices, and AI responses that return after the underlying task was edited or deleted. Flag any code path that would resurrect a deleted item or overwrite intervening user edits.

## AI proposals

- Flag any write that persists AI-generated steps, plans, or breakdowns directly into the approved task/plan tables without an explicit user approval action.
- Verify proposals store the source revision (task/project version) they were generated against. Flag approvals that apply without checking the source revision is still current, or at minimum surfacing the drift.
- Verify cancel/stale/failed states exist and are handled. Flag code that assumes AI calls either succeed or throw.
- When reviewing "Make it easier" / regenerate / partial-accept flows, check that prior user edits inside the proposal draft are preserved.

## Synchronization and conflicts

- Flag indiscriminate last-write-wins on task content, hierarchy moves, or focus state. The spec requires preserving meaningful conflicting edits for recovery.
- When reviewing focus-session code, check that concurrent actions from two devices reconcile deterministically and never silently drop a completion event.
- Verify task metadata syncs independently of large attachments. Flag code that blocks task visibility on attachment download.

## Calendar

- When reviewing calendar ingestion, probe for: recurring events with exceptions, cancellations, all-day events, time zones, and DST transitions. Flag naive date math (e.g., adding 24h for "next day", using local time without zone awareness).
- Flag any code path that writes to an external calendar feed — writing back is not an agreed requirement.
- Imported events and app-created task blocks must remain distinguishable in the data model and UI. Flag code that merges them into a single type without a source discriminator.
- Flag UI that presents calendar data as live/instant; freshness and error state must be visible.

## Printing and scheduling

- When reviewing print scheduling, verify behavior for: plan approved before print time (print at scheduled time), approved after print time (print immediately on approval), unapproved at print time (do not print), and repeated approvals (do not duplicate).
- Verify every print job carries a stable identifier and that the worker persists dispatch state. Flag any retry logic that can produce duplicate prints without exposing "uncertain" state for user decision.
- Flag code that treats a successful socket write or driver call as proof of physical printing.
- When reviewing briefing generation, verify the printed artifact is a snapshot captured at queue time, not a live render of the current template.

## Focus and feedback

- Verify elapsed time derives from stored timing events (start/pause/resume/stop) rather than a per-second counter being synced.
- Flag remote-sync paths that would replay celebration sounds or animations on devices that were not the one completing the step.
- Verify mute (master + per-feedback) is respected everywhere audio/animation is triggered. Flag any new feedback trigger that bypasses user preferences.

## Edge cases to actively probe

- Empty data: no tasks today, no calendar events, no weather, missing image in template.
- Very long text in briefing sections and task titles; ensure QR codes remain scannable and layout does not clip.
- Planned rest days: streak logic must not penalize these.
- Daylight saving transitions around the user's print time and evening planning time.
- Browser storage limits and eviction on the phone; the browser cache is not a durable backup.

## Scope discipline

- When a PR touches shared code (sync, focus session, proposal store, print queue), check that unrelated features still behave per spec. Flag incidental behavior changes without explicit mention in the PR.
- Flag silent decisions on items listed as open in Section 9 of the spec (printer model, time-zone policy, streak rules, weather provider, AI provider, retention). They need to be documented as a chosen default, not buried in code.

## Things NOT to flag

- API token cost / prompt-length optimization concerns. The spec explicitly says cost is not a primary constraint; relevance, correctness, and user control are.
- Absence of multi-user, team, or shared-workspace features. Out of scope for the initial product.
- Absence of a native mobile app or push notifications on mobile. The phone target is a responsive browser app only.
- Writing task-created time blocks back to external calendars is not required; its absence is not a gap.
