# Daily Driver — Project Specification

Status: Product baseline for implementation

Date: 2026-11-06  
Audience: Implementers

## 1. Purpose

Daily Driver is a personal, local-first task application that helps its owner overcome procrastination by turning intimidating work into small, actionable steps. It combines planning, focused execution, contextual AI assistance, and physical daily briefings printed on a receipt printer.

The app must work across a personal Mac laptop, a work Mac laptop, and a phone browser. A connected Mac mini at the user's electronics workstation runs the printing service.

**Core principle: AI prepares; the user decides.** The user should have a useful starting point without losing control of tasks, commitments, or plans.

This document distinguishes confirmed product requirements from proposed implementation choices. Resolve open technical decisions through documented experiments rather than treating recommendations as verified integrations.

## 2. User and scope

- One user initially; shared workspaces and team collaboration are outside the initial scope.
- Installable macOS application on both laptops.
- Responsive browser application on the phone; no native mobile application required.
- Full task editing and progress tracking across devices, including simultaneous use.
- Offline task management, with synchronization and cloud AI work resuming after reconnection.
- Cloud AI may process context the user supplies.
- API token cost is not a primary optimization constraint. Relevance, responsiveness, correctness, and user control remain constraints.

### Reference workflow

The user enters: “Update the case studies on my design portfolio so I can start applying for jobs.”

The app asks only essential clarifying questions, uses supplied portfolio material, and proposes a reviewable breakdown. An opening step might be “Open the case study you want to update first,” with an explicit definition of done. The user can approve or edit the draft, choose step size, start work, or request an even smaller step.

## 3. Product principles

1. Local actions should feel immediate and must not wait for a network round trip.
2. Steps should be quick, well-defined, approachable, and ready to perform.
3. Show one prominent current step while keeping context and progress accessible.
4. AI suggestions must remain distinguishable from user-approved work.
5. Defer, simplify, and switch are normal actions, not failures.
6. Preserve user edits, including during offline use, concurrent edits, and delayed AI responses.
7. Physical printing is a first-class workflow, not a browser print-dialog workaround.
8. Sounds, animation, timers, streaks, and progress should support motivation and remain controllable.

## 4. Functional requirements

### 4.1 Capture, hierarchy, and context

- Support standalone tasks and hierarchical projects/tasks/microsteps.
- Example hierarchy: Get a design job → Update portfolio → Update case study → Microsteps.
- Let users create, edit, reorder, and organize work manually.
- Accept task descriptions, project notes, links, documents, photos, and other supplied attachments. Establish supported file types explicitly during implementation; do not imply every format is readable.
- Attach context to the relevant task or project, with visible processing status and actionable failures for unsupported or unreadable material.
- AI suggestions should identify relevant source material where practical, allowing the user to inspect their basis.
- Separate original attachments from extracted text, thumbnails, and AI-generated interpretations.

### 4.2 AI breakdown and assistance

- Ask targeted clarification questions when missing information materially changes the breakdown.
- Generate a reviewable draft before committing generated microsteps.
- Allow editing, partial acceptance, rejection, and regeneration of proposals.
- Give the user control over desired step size.
- Provide a persistent “Make it easier” action for the current step.
- Describe a concrete action and definition of done for each proposed microstep.
- Use supplied project context, deadlines, calendar availability, and relevant completion history to improve suggestions.
- Queue AI requests when offline. Show whether work is queued, running, ready for review, failed, or canceled.
- A delayed response must not overwrite intervening edits or silently revive deleted work.
- Treat fetched pages and attachment content as context, not authority to execute instructions or change application permissions.

### 4.3 Daily planning and calendar

- Support manual task selection, AI-suggested plans, and calendar time blocking with drag and drop.
- Pull external events from Google Calendar and Outlook so appointments, calls, games, and other commitments inform availability.
- Prefer read-only calendar subscription links for the initial integration where supported.
- Calendar feeds are periodically fetched; do not promise instantaneous external event updates. Display freshness and errors.
- Support recurring events, exceptions, cancellations, all-day events, time zones, and daylight-saving transitions.
- Keep imported events distinguishable from app-created task blocks. Writing blocks back to external calendars is not an agreed initial requirement.
- Prepare the next day's suggested plan the evening before.
- Continue preparing proposed adjustments in the background as work and availability change.
- Keep approved plans stable until the user accepts changes; present proposed changes with reasons.
- Let the user approve an entire plan or selected suggestions.
- A daily review proposes unfinished work to carry forward, shrink, defer, or drop; the user makes the final decision.

### 4.4 Focus and execution

- Show one prominent active step with its definition of done and accessible project context.
- Provide inline, fullscreen, and separate desktop-window focus views.
- Support completing, simplifying, deferring, and switching tasks.
- Default defer behavior: move the task later in today's queue.
- Also support deferring to a chosen date or an unscheduled backlog; let the user change the default.
- Maintain one logical focus session across devices, including the current step and timer state.
- Browsing another project on a device must not implicitly replace the active focus session.
- Calculate elapsed time from session timing events rather than synchronizing a counter every second.
- Define deterministic reconciliation for concurrent or offline focus actions; never silently lose completed work.
- Show progress, optional timers, streaks, completion animation, and interaction sounds.
- Planned rest days must be supported by streak rules. Daily review language should remain neutral and constructive.
- Provide individual feedback controls and a master mute. Remote synchronization should update other devices silently rather than replaying local celebration sounds everywhere.

### 4.5 Daily briefing and visual template editor

- Provide a visual editor, not only a settings form for a fixed receipt.
- Allow adding, removing, reordering, and configuring data sections.
- Initial section types: selected tasks, scheduled items, progress, notes space, weather, quote, custom text, images, dividers, and task QR codes.
- Provide typography, spacing, and layout controls within the printable receipt width.
- Use a paper preview with section controls and properties for the selected element.
- Show representative data and handle empty sections, long text, missing images, and unavailable weather gracefully.
- Use a common rendering definition for preview and print output, calibrated against the actual printer.
- Printed task QR codes must open stable, authenticated task pages in the phone browser for quick completion.
- QR codes must not contain account credentials or grant unauthenticated task modification.
- Keep templates separate from generated briefing snapshots so subsequent template edits do not alter queued jobs unexpectedly.

### 4.6 Print automation

- Configure daily briefing print time inside the app.
- If the plan is approved by the scheduled time, queue its briefing for printing.
- If it is not approved, wait. Approval after the scheduled time should trigger printing immediately.
- Approval before the scheduled time should retain the scheduled print time.
- Provide manual printing and explicit reprinting.
- The Mac mini worker must run independently of an open laptop app and recover after restart.
- Jobs must survive temporary printer, network, and worker unavailability.
- Track queued, processing, dispatched, failed, and uncertain outcomes as appropriate to actual hardware feedback. Do not label a job physically printed merely because bytes were sent.
- Prevent ordinary duplicate delivery with stable job identifiers and persisted worker state.
- Where delivery may have succeeded before a failure, show uncertainty and require an explicit retry decision instead of blindly printing another copy.
- Do not expose the printer directly to the public internet. The worker should establish an authenticated outbound connection to obtain jobs.
- Validate actual printer connectivity, raster output, paper width, cutting, and QR readability on hardware before declaring the printing integration complete.

## 5. Visual direction

Use the user-supplied Linear screenshot as the visual reference and **shadcn/ui** as the component foundation, customized through shared design tokens.

- Near-black backgrounds and subtly lighter panels.
- Fine borders, restrained shadows, and modest corner radii.
- Compact navigation, muted icons, clear typography, and legible contrast.
- Sparse accent colors for active work, progress, and approval states.
- Generous primary-content space with supporting details in collapsible panels.

### Application structure

- Left navigation: Today, Inbox, Projects, Calendar, Briefings, and favorites.
- Main workspace: daily plan, project hierarchy, calendar, task details, or focus view.
- Collapsible AI panel: clarification, proposed steps, and plan changes with explicit review controls.
- Receipt editor: section controls, centered paper preview, and selected-element properties.
- Mobile: dedicated views and a slide-over assistant rather than a compressed desktop layout.

Use Cuelume for interaction sounds subject to integration validation. Support keyboard navigation, visible focus, accessible control names, reduced motion, sufficient contrast, and touch-friendly mobile actions. Sound or color must never be the sole indicator of state.

## 6. Proposed technical architecture

These choices are the recommended starting point, not claims of an already working implementation.

| Layer | Proposed approach | Purpose |
| --- | --- | --- |
| Shared interface | React + TypeScript + shadcn/ui | Reuse task, planning, editor, and review interfaces |
| macOS shell | Tauri | Installed desktop app, separate windows, OS integration |
| Phone access | Responsive web app with offline app-shell support | Browser-based use and QR landing pages |
| Local data | SQLite through platform-appropriate adapters | Immediate reads/writes and offline work |
| Synchronization | PowerSync with Postgres | Propagate durable changes across devices |
| Attachments | Object storage with local caching | Keep large files separate from task synchronization |
| Background processing | Durable server-side jobs | AI requests, ingestion, calendar refresh, planning |
| Printing | Persistent worker on the Mac mini | Local hardware access and job recovery |
| Sound | Cuelume | Consistent synthesized interaction feedback |

Validate the Tauri/PowerSync integration, shared state across desktop windows, and mobile-browser storage behavior before committing deeply to the data layer. Select hosting, authentication, model providers, job infrastructure, and storage providers in implementation decisions.

### Data and ownership rules

- UI interactions commit locally; network delivery occurs asynchronously.
- The sync backend is the cross-device coordination point, with explicit application-level conflict rules.
- Store AI proposals separately from approved tasks and plans, including the source revision used to generate them.
- Apply approvals transactionally and idempotently so retries cannot duplicate tasks or print jobs.
- Preserve meaningful conflicting user edits for recovery rather than relying on indiscriminate last-write-wins behavior.
- Synchronize task metadata before or independently of large attachment downloads.
- Cache task data and the browser app shell for offline use; clearly distinguish cached attachments from files that still need downloading.
- Browser storage has platform limitations. Test persistence and recovery, and never present a browser cache as the only durable backup.
- Keep provider credentials on trusted server/worker surfaces, not in the browser bundle. Protect private calendar feed URLs as secrets.
- Authentication and authorization must cover sync, attachments, AI jobs, printing, and QR task routes even for a single-user deployment.

### Initial domain entities

Projects; tasks with parent relationships; context items and attachments; AI requests and proposals; daily plans and revisions; calendar sources and imported events; task time blocks; focus sessions and timing events; user preferences; receipt templates; briefing snapshots; printers/workers; print jobs and attempts.

The detailed schema is an implementation deliverable. Keep domain behavior independent of UI components and provider-specific clients where practical.

## 7. Delivery sequence

### Stage 1 — Prove the foundation

- Local task creation/editing and hierarchy on desktop and browser.
- Cross-device synchronization and offline/reconnect behavior.
- Shared focus-session continuity, including separate desktop windows.
- One actual receipt printed by the Mac mini, with a phone-readable task QR code.
- Use the portfolio case-study example as the end-to-end scenario.

### Stage 2 — Complete the daily workflow

- Context-aware AI breakdown drafts and approval.
- Adjustable step size, simplification, defer, and switch.
- External calendar availability and task time blocking.
- Suggested daily plans, review, approval, and scheduled briefing printing.

### Stage 3 — Complete the experience

- Visual receipt template editor and calibrated rendering.
- Rich document/photo/link ingestion and background replanning.
- Interaction sounds, animation, progress, streaks, and planned rest days.
- Recovery, accessibility, and performance polish across all supported surfaces.

All stages are part of the intended product. Sequencing does not remove later-stage requirements.

## 8. Acceptance criteria

Implementation should satisfy the following behavior and recovery criteria, with validation appropriate to each feature.

### Validation criteria by affected area

- **Local-first behavior:** no network dependency for ordinary local task edits; local writes survive restart; queued operations recover after reconnection.
- **Synchronization:** test two clients, concurrent changes, deleted items, repeated delivery, and focus-session conflicts. Confirm unrelated edits remain intact.
- **AI control:** generation does not commit work without approval; edits made during generation survive; canceled/stale proposals cannot overwrite current work; failures remain recoverable.
- **Calendar correctness:** cover recurrence exceptions, canceled events, time zones, all-day events, and stale feeds. Do not confuse imported events with editable task blocks.
- **Scheduling:** verify approval before and after print time, repeated approval, worker restart, unavailable printer, and daylight-saving/time-zone behavior.
- **Printing:** confirm real output and QR scanning; distinguish dispatch from physical completion; handle uncertain delivery without automatic duplicates.
- **Visual editor:** preview and output use consistent layout rules; variable content does not clip important information or make QR codes unreadable.
- **Privacy/security:** no secrets in client code, logs, QR codes, or receipts; authenticated access to user data and printer jobs; supplied content cannot authorize actions.
- **Accessibility:** keyboard operation, visible focus, semantic labels, reduced motion, mute, and non-audio feedback are preserved.
- **Performance:** expensive AI, ingestion, rendering, and sync work do not block interaction. Measure representative workloads and record budgets before declaring performance complete.
- **Scope:** changes preserve unrelated functionality and explicitly document any user-visible deviation from this spec.

### End-to-end acceptance scenarios

1. Create the portfolio task offline, restart the app, reconnect, and see it on the other laptop and phone without duplication.
2. Request a breakdown offline; reconnect; review the generated draft; approve selected steps without losing manual edits made while waiting.
3. Start a step and timer on one laptop; continue on the phone; complete it once; observe consistent progress on both laptops without duplicate celebration sounds.
4. Defer a task to later today, change the default defer behavior, and verify subsequent actions use the saved preference.
5. Prepare tomorrow's AI plan around imported appointments; edit and approve it; verify later AI suggestions do not silently modify the approved plan.
6. Leave a plan unapproved at print time; verify nothing prints; approve later; receive one briefing through the Mac mini.
7. Interrupt printing at an ambiguous point; verify the system exposes uncertainty instead of silently retrying and producing duplicates.
8. Customize the receipt visually, print it, scan a task QR code, authenticate if needed, and complete the intended task from the phone.
9. Mark a planned rest day and perform the next daily review without an unintended streak penalty or automatic task commitment.

## 9. Decisions still to validate

- Exact printer model, connection mode, command support, printable resolution/width, and useful status feedback.
- Tauri/PowerSync adapters and phone browser persistence on the user's actual devices.
- Conflict semantics for simultaneous task edits, hierarchy moves, and offline focus changes.
- Calendar-feed availability for the work account, refresh cadence, and need for future direct API integrations.
- Default evening planning time, print time, home/travel time-zone policy, and handling of stale jobs from previous days.
- Weather location/provider, quote source, AI providers, hosting, authentication, and backup/export strategy.
- Attachment format/size support, extraction pipeline, caching limits, and retention/deletion behavior.
- Exact streak rules, timer modes, and measurable performance budgets.

These decisions should not trigger another broad product discovery cycle. Use sensible documented defaults where reversible; resolve hardware and data-integrity risks with focused prototypes.

## 10. References

- [Task breakdown and motivation principles](https://www.colonnes.com/make-your-tasks-as-easy-as-playing-a-video-game)
- [Colonnes product inspiration](https://www.colonnes.com)
- [Candidate Rongta receipt printer](https://www.amazon.com/dp/B0CNT2F4Q5)
- User-supplied daily receipt photo: `HWSHnqDWAAEESsd.jpeg`.
- User-supplied UI reference: `Screenshot 2026-11-06 at 8.58.58 PM.png` (Linear interface).
- [Cuelume interaction sounds](https://cuelume-site.pages.dev)
- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [PowerSync web SDK](https://docs.powersync.com/client-sdks/reference/javascript-web)
- [Google Calendar iCal subscriptions](https://support.google.com/calendar/answer/37648)
- [Outlook calendar publishing](https://support.microsoft.com/en-us/outlook/sharing/share-an-outlook-calendar-as-view-only-with-others)

The supplied image attachments are conversation references, not currently bundled repository assets. Preserve copies in the repository when establishing the design assets.
