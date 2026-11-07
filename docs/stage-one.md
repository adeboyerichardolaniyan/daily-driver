# Stage 1: local foundation

Status: Local foundation implemented; cloud and hardware acceptance still require setup.

## What works now

The shared React/shadcn interface runs in the browser and a packaged macOS Tauri app. Tasks are stored in local SQLite using PowerSync's web adapter. The portfolio workflow can be loaded explicitly as editable example data; it is not represented as AI output.

Users can create projects and standalone tasks, nest steps, edit title/context/definition of done, choose estimated minutes, move work into Today or the backlog, reorder to the end of a queue, complete/reopen, and archive/restore. A focus session has a shared active step and a timestamp-derived timer. Separate windows can pause/resume the same session. Merely browsing or editing a task does not change focus.

The receipt screen provides a basic fixed template, QR links, and explicit manual print submission. Scheduling and the visual template editor belong to later stages. Today is currently a persistent queue, not an automatically generated date-specific plan.

## Architecture decisions

### Storage and desktop compatibility

- The browser stores SQLite through IndexedDB and runs database work in a worker when supported.
- The packaged macOS app uses the same durable SQLite/IndexedDB adapter with `useWebWorker: false` and `enableMultiTabs: false`. WKWebView rejected cross-origin worker scripts under Tauri's `tauri://localhost` protocol during actual bundle testing.
- In this SDK, disabling multi-tab workers still permits multiple windows with coordinated local storage, but only one window can own synchronization at a time. Local task and focus continuity were exercised in two actual Tauri windows.
- The desktop fallback runs SQLite on the webview thread. This is an explicit foundation tradeoff, not a claim that native database performance is settled. Before increasing data scale, benchmark it and evaluate PowerSync's native Tauri adapter (currently alpha). Keep the domain/repository boundary unchanged if migrating.
- Development browser, development desktop, and packaged desktop may use different origins and therefore separate local workspaces. Use sync to share across them once configured; do not expect sample data to appear automatically between origins.
- Browser storage remains subject to browser/OS policy. Settings offers a persistence request and task-history export. Sync is not a substitute for a tested backup policy.

### Event history and reconciliation

`workspace_events` is append-only. Each event has a UUID, actor ID, Lamport clock, timestamp, and validated action payload. A local transaction assigns clocks and records related actions atomically. The server authenticates ownership and accepts idempotent retries without updating an existing event.

Events project into tasks and the active focus session in stable order: clock, actor ID, then event ID. Task edits patch only changed fields, so unrelated concurrent edits merge. Concurrent edits of one field converge to a deterministic winner; both versions remain visible in task history and JSON export. This is not a semantic conflict-resolution UI. Invalid hierarchy links become roots instead of hiding tasks or causing recursion.

Focus actions reference a session ID. Events for an old session cannot pause or stop a newer session. Concurrent starts converge using the same stable ordering. Timer elapsed time is derived from start/pause/resume timestamps; device clock skew remains a limitation to validate on actual devices.

The complete event history is currently projected in memory. Compaction, indexing of projected state, conflict-resolution UI, and large-history performance budgets are future work before long-term heavy use.

### Offline startup

Opening the workspace waits only for local storage. Authentication refresh and sync connection happen afterward. An unavailable backend must not prevent local task work. The production browser app precaches its shell and SQLite assets; first-ever browser access still requires connectivity.

### Backend choice

Supabase is the initial Postgres/auth provider, with PowerSync handling downstream synchronization. This is a concrete implementation choice introduced in Stage 1, not an additional product requirement. No project has been provisioned or charged through this repository.

## Set up cross-device synchronization

1. Create a dedicated Supabase project and apply `supabase/migrations/202611070001_foundation.sql` through its SQL editor or migration CLI.
2. Disable public account sign-up. Create your one email/password auth user through the provider's administrative UI.
3. Add that user's UUID to the allowlist using the administrative SQL editor:

   ```sql
   insert into public.app_members(user_id) values ('YOUR_AUTH_USER_UUID');
   ```

4. Create/configure a PowerSync instance against this Postgres database using the provider's replication-role/publication setup. Replicate `workspace_events`; printing stays on Supabase.
5. Configure PowerSync to validate this Supabase project's JWTs. Deploy `powersync/sync-config.yaml` as its sync-stream configuration.
6. Copy `.env.example` to `.env.local` and set the four public `VITE_*` variables. The Supabase publishable key is intended for the client; never substitute a service-role key. Set `VITE_PUBLIC_APP_URL` to the real HTTPS browser-app origin used by your phone.
7. Rebuild/restart the app. In Settings & connections, sign in. Sign in with the same account on each device. Existing local events upload on connection.
8. If your PowerSync hostname differs from the permitted hosts in `src-tauri/tauri.conf.json`, add the exact trusted host to `connect-src` and rebuild. Do not use an unrestricted wildcard.

The local database binds to the first account it connects to and refuses a different account. There is no account-switching or destructive reset UI in this foundation. An app member can read only their own events and print jobs; public/other accounts cannot append events or claim jobs.

### Cloud acceptance still required

- Make a task on laptop A and observe it on laptop B and the phone.
- Disconnect A, edit title and notes independently across devices, reconnect, and inspect convergence/history.
- Refresh an expired session while offline, then restore connectivity.
- Move the active focus session between the phone and both Macs.
- Validate provider replication configuration and actual delivery latency.

Unit and embedded-Postgres tests cover reconciliation and database permissions, but do not replace these deployed-service checks.

## Set up the Mac mini print worker

The initial transport is the macOS CUPS spooler (`lp`), using the printer's installed driver. Direct ESC/POS transport is not assumed without verifying the exact model. The worker creates a receipt PDF and submits it to the configured printer. It does not expose a network listener.

1. Install the printer and its macOS driver on the Mac mini. Verify a normal system print, paper size, and cutter behavior. Find the queue name with `lpstat -p`.
2. Install Node.js 24+, clone this repository on the Mac mini, run `npm ci`, and install the rendering browser with `npx playwright install chromium`.
3. Create a private `.env.worker` containing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `WORKER_EMAIL`, `WORKER_PASSWORD`, `PRINTER_NAME`, and a stable `WORKER_ID`. Use the same allowlisted account. Restrict the file to its owner (`chmod 600 .env.worker`). Never commit credentials.
4. Run `npm run print:worker` on the mini. Its state directory defaults to `.print-worker`; use a stable `PRINT_STATE_DIR` outside the checkout if deployments replace it.
5. On the app's Briefings screen, preview the receipt, then explicitly send it to the mini. Refresh print activity to see the outcome.
6. Inspect the physical receipt and scan each QR code with the phone. Authenticate to the same workspace if needed. The linked task has a direct completion action.

For unattended operation, register the command as a per-user macOS LaunchAgent with `RunAtLoad` and `KeepAlive`, an absolute Node path, this checkout as its working directory, and log paths. Do not put the password directly in a tracked plist. A LaunchAgent runs after login; printing before login or with a sleeping machine is not promised. Keep the workstation awake when scheduled printing is added.

### Print safety and recovery

- Jobs contain immutable receipt snapshots. Template/task changes do not change an already queued receipt.
- An atomic backend claim prevents two workers from taking the same queued job.
- A local SQLite journal records dispatch attempts; a separate exclusive SQLite lock prevents simultaneous processes using the same worker state directory.
- A successful `lp` call means **dispatched to the spooler**, not physically printed.
- A crash or timeout after dispatch begins becomes **uncertain**. These jobs are not automatically reclaimed or retried. Inspect the printer/spooler first, then explicitly submit another briefing if appropriate.
- A rendering failure before dispatch becomes **failed**. After correcting it, explicitly submit again.
- Receipt PDFs and snapshots remain in the local worker state directory for diagnosis. Retention cleanup is not automated yet.
- Browser-to-cloud print submission currently needs connectivity. Durable offline print requests and scheduled/approval-gated generation are not implemented in Stage 1.

## Verification performed

- TypeScript checks and production web build.
- Rust compilation and a packaged, unsigned debug macOS app build.
- Actual macOS app launch, example creation, timer start, detached focus window, and pause propagation back to the main window.
- Chromium and WebKit browser tests for local task persistence, offline edits, multi-window focus, mobile hierarchy editing, and a fully offline reload of the production app shell.
- Domain tests for duplicate delivery, concurrent edits, preserved completion, hierarchy cycles, and focus-session ordering.
- Embedded Postgres tests executing the migration and checking ownership, denied mutable writes, idempotent event upload, job claiming, and uncertain-outcome handling.
- Receipt rendering tests for text escaping and stable credential-free HTTPS QR links.

No deployed sync service or physical printer was available for this implementation session. Stage 1 is not fully accepted until the cloud and hardware checks above pass.

## Deferred features

AI requests and generation, source ingestion, Google/Outlook calendar feeds, nightly planning, approval-driven/scheduled printing, a visual template editor, Cuelume sounds, streaks, backup import UI, and signed/notarized distribution are not active yet. The UI labels the assistant as upcoming; it does not simulate AI responses.
