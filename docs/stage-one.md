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

Server `workspace_events` and local `event_log` preserve append-only event content. Each event has a UUID, actor ID, Lamport clock, timestamp, and validated action payload. A local transaction assigns clocks and records related actions atomically. The server authenticates ownership and accepts idempotent retries without updating an existing event.

Events project into tasks and the active focus session in stable order: clock, actor ID, then event ID. Task edits patch only changed fields, so unrelated concurrent edits merge. Concurrent edits of one field converge to a deterministic winner; both versions remain visible in task history and JSON export. This is not a semantic conflict-resolution UI. Invalid hierarchy links become roots instead of hiding tasks or causing recursion.

Focus actions reference a session ID. Events for an old session cannot pause or stop a newer session. Concurrent starts converge using the same stable ordering. Timer elapsed time is derived from start/pause/resume timestamps; device clock skew remains a limitation to validate on actual devices.

The complete event history is currently projected in memory. Compaction, indexing of projected state, conflict-resolution UI, and large-history performance budgets are future work before long-term heavy use.

### Offline startup

Opening the workspace waits only for local storage. Authentication refresh and sync connection happen afterward. An unavailable backend must not prevent local task work. The production browser app precaches its shell and SQLite assets; first-ever browser access still requires connectivity.

### Backend choice

Convex is the cloud backend. Convex Auth handles private email/password sign-in, and ordinary authenticated Convex queries and mutations handle synchronization and printing. **Convex Pro, Streaming Export, and a PowerSync service are not required.** Normal Convex Free plan quotas still apply. The PowerSync JavaScript library remains only as a local SQLite adapter and reactive SQL interface.

The initial PowerSync service integration was removed because Convex's [Streaming Export API requires Pro](https://docs.convex.dev/production/integrations/streaming-import-export). No deployment key or replication service is used by the app now.

### Direct synchronization and migration

Local edits commit immediately to the local-only `event_log` table with `uploaded = 0`. The synchronizer uploads bounded batches through `workspace:appendEvents`. It marks events uploaded only after server acknowledgement. Retries are idempotent, including after an uncertain network response or process crash.

Each new server event receives a per-owner increasing sequence in the same mutation as its insert. A small reactive `workspace:head` query wakes clients when data changes. Clients fetch indexed pages after their saved sequence and atomically persist events with the new cursor. A thirty-second fallback retries temporary failures; normal updates are driven by local SQL changes and Convex notifications. Multiple windows may repeat requests safely without duplicating events or moving the cursor backward.

Each device first performs a bounded, resumable bootstrap of the owner's existing events. This includes events written before server sequences existed. New events arriving during bootstrap are subsequently replayed through the sequence feed. Incoming events never enter the upload queue. Event IDs with differing content stop synchronization with an error rather than overwriting history.

On launch, legacy local `workspace_events` rows are copied into `event_log` without clearing the old table or queue. Existing task/focus IDs and account bindings are preserved. Legacy copies remain available for recovery; new writes use `event_log`. Restart all old app windows after updating. Storage/history compaction is future work.

## Set up cross-device synchronization

1. Run `npm run convex:dev` against the dedicated development deployment. The CLI writes `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` into `.env.local` and refreshes generated bindings. Keep it running while changing backend code.
2. Follow [Convex Auth setup](https://labs.convex.dev/auth/setup), running `npx @convex-dev/auth` against that deployment to configure signing keys and `SITE_URL`. For local development, the web server URL is `http://127.0.0.1:1420`. The repository already contains the private auth configuration; preserve its sign-in restriction if the setup tool offers file edits.
3. In the authenticated Convex dashboard, run the **internal** `admin:provisionOwner` action with your email and a strong password (at least 12 characters). It creates the password account and singleton workspace membership. Public sign-up/reset flows are disabled. Recovery UI is not implemented.
4. Set `VITE_CONVEX_URL` in `.env.local`. For phone receipt links, set `VITE_PUBLIC_APP_URL` to the real HTTPS browser app origin. Remove any obsolete `VITE_POWERSYNC_URL`; it is ignored. You can delete the unused PowerSync instance and revoke its deployment key in the respective dashboards.
5. Run `npm run dev` or rebuild/restart the Mac app. In Settings & connections, sign in using the provisioned account. Use the same account and deployment on every device. Existing unbound local events upload automatically. Local startup does not wait for authentication.
6. For production, deploy with `npm run convex:deploy`, configure production auth keys/owner/worker secret, and build the app with its production public URLs. Development and production workspaces are separate.
7. Custom Convex domains require their exact trusted origins in `connect-src` in `src-tauri/tauri.conf.json` and a rebuild.

The local database binds to its first Convex account and deployment and refuses another. No local history is deleted. A previously Supabase-bound workspace requires an explicit export/migration rather than silently rebinding. Existing Convex-bound workspaces retain their identity through the direct-sync update.

### Cloud acceptance still required

- Make a task on laptop A and observe it on laptop B and the phone.
- Disconnect A, edit title and notes independently across devices, reconnect, and inspect convergence/history.
- Refresh an expired session while offline, then restore connectivity.
- Move the active focus session between the phone and both Macs.
- Validate provider replication configuration and actual delivery latency.

Domain and `convex-test` tests cover reconciliation, authorization, input validation, and transactional backend behavior, but do not replace these deployed-service checks.

## Set up the Mac mini print worker

The initial transport is the macOS CUPS spooler (`lp`), using the printer's installed driver. Direct ESC/POS transport is not assumed without verifying the exact model. The worker creates a receipt PDF and submits it to the configured printer. It does not expose a network listener.

1. Install the printer and its macOS driver on the Mac mini. Verify a normal system print, paper size, and cutter behavior. Find the queue name with `lpstat -p`.
2. Install Node.js 24+, clone this repository on the Mac mini, run `npm ci`, and install the rendering browser with `npx playwright install chromium`.
3. Create a private `.env.worker` containing `CONVEX_URL`, `PRINT_WORKER_SECRET`, `PRINTER_NAME`, `PRINT_MODE=printer`, and a stable `WORKER_ID`. Set the same strong, randomly generated `PRINT_WORKER_SECRET` (at least 32 characters) in the Convex deployment environment. This credential grants only the dedicated worker functions, not task access. The worker requires no user password. Restrict the file to its owner (`chmod 600 .env.worker`). Never commit credentials.
4. Run `npm run print:worker` on the mini. Its state directory defaults to `.print-worker`; use a stable `PRINT_STATE_DIR` outside the checkout if deployments replace it.
5. On the app's Briefings screen, preview the receipt, then explicitly send it to the mini. Refresh print activity to see the outcome.
6. Inspect the physical receipt and scan each QR code with the phone. Authenticate to the same workspace if needed. The linked task has a direct completion action.

For unattended operation, register the command as a per-user macOS LaunchAgent with `RunAtLoad` and `KeepAlive`, an absolute Node path, this checkout as its working directory, and log paths. Do not put the worker secret directly in a tracked plist. A LaunchAgent runs after login; printing before login or with a sleeping machine is not promised. Keep the workstation awake when scheduled printing is added.

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

Convex migration checks: 30 unit tests, eight production browser tests across Chromium/WebKit, TypeScript, Rust compilation, and a rebuilt unsigned debug macOS bundle pass. Direct-sync tests cover durable retries, bootstrap resumption, cursor commits, cleanup, account binding, and legacy SQLite migration. The functions were deployed to `harmless-dolphin-909`, and the bootstrap query was exercised with an administrator-supplied owner test identity. Real sign-in and live multi-device acceptance remain outstanding.

- TypeScript checks and production web build.
- Rust compilation and a packaged, unsigned debug macOS app build.
- Actual macOS app launch, example creation, timer start, detached focus window, and pause propagation back to the main window.
- Chromium and WebKit browser tests for local task persistence, offline edits, multi-window focus, mobile hierarchy editing, and a fully offline reload of the production app shell.
- Domain tests for duplicate delivery, concurrent edits, preserved completion, hierarchy cycles, and focus-session ordering.
- Convex in-memory tests executing the actual functions for ownership, event validation, atomic collision rejection, idempotent retries, exclusive job claiming, worker authentication, and terminal/uncertain print outcomes. These complement deployment verification but do not replace live multi-device tests.
- Receipt rendering tests for text escaping and stable credential-free HTTPS QR links.

The development backend is deployed. Stage 1 is not fully accepted until real cross-device synchronization and the physical printer checks above pass.

## Deferred features

Source ingestion, approval-driven/scheduled printing, a visual template editor, Cuelume sounds, streaks, backup import UI, and signed/notarized distribution are not active yet. AI task breakdown is now implemented; see [AI breakdown](ai-breakdown.md) for configuration and validation limits.

Calendar feeds, editable daily availability, evening drafts, and approval-driven replanning are implemented. See [Calendar-aware planning](calendar-planning.md).
