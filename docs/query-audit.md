# Query index and read-budget audit

Audited 2026-11-12 across all application-owned Convex queries, local PowerSync/SQLite reads, and the print worker journal. The live web and Mac apps use `dev:harmless-dolphin-909`.

## Incident and correction

The briefing owner index was present, but reading up to 10,001 complete events in one transaction was not safe. Live insights recorded 40 failures; one invocation read 16,842,403 bytes from 611 workspace events. Repeated calendar snapshots accounted for most of the history.

Briefings, schedule reconciliation, and planning now replay the immutable history in separate indexed queries with a 500,000-byte page budget. Reads pin the workspace sequence and include legacy unsequenced events. Commits compare that sequence to the current head and retry if a device or background task changed the workspace. The returned projection omits its raw event-log copy, keeping history out of action arguments and results. Existing events are neither deleted nor truncated.

The byte budget is a soft pagination boundary: the final document can cross it. Individual documents remain subject to Convex's 1 MiB limit, leaving ample room below the 16 MiB transaction limit. Complete history replay still reads the full history across pages; this fixes transaction sizing, not total historical storage or aggregate replay bandwidth.

## Convex coverage

All 52 application query chains use declared indexes. Direct `db.get` calls use primary document IDs. No application database query uses `.filter()` or unbounded `.collect()`.

| Read path | Index / bound |
| --- | --- |
| Workspace authorization, owner provisioning, worker owner invariant | `app_members.by_user`; unique, first, or at most two members |
| Event identity / deduplication | `workspace_events.by_uuid`; unique |
| Server event clock allocation | `workspace_events.by_owner_id_and_clock`; latest one |
| Workspace revision | `workspace_heads.by_owner`; unique |
| Initial client synchronization | `workspace_events.by_owner`; at most 50 rows and a 500 KB page budget |
| Incremental client synchronization | `workspace_events.by_owner_sequence`; sequence range, at most 20 rows and a 500 KB page budget |
| Backend workspace projection | `workspace_events.by_owner_sequence`; owner and captured sequence range, at most 100 rows and a 500 KB page budget |
| Briefing status/settings | `briefing_schedules.by_owner`; unique |
| Due briefings | `briefing_schedules.by_nextRun`; due range, at most 20 |
| Briefing idempotency | `briefing_runs.by_owner_day`; unique |
| Planning settings | `planning_preferences.by_owner`; unique, or 20-row/500 KB pages for the cron |
| Planning jobs | `by_plan` unique, `by_owner_date` latest one, `by_status` at most 10 |
| AI/content jobs | `by_request_id` unique, `by_status` at most 10 |
| Calendar source cap | `calendar_sources.by_owner`; at most 11 to enforce the 10-calendar limit |
| Calendar refresh queue | `calendar_sources.by_refresh`; due range, at most 20 with a 500 KB page budget |
| Print job identity | `print_jobs.by_uuid`; unique |
| Visible delivery activity | `print_jobs.by_owner_and_deleted`; latest 10, bounded by the 500 KB receipt upload limit |
| Interrupted printer jobs | `print_jobs.by_owner_id_and_worker_id_and_status`; batches of 10; recovery drains batches before claiming new work |
| Printer/PDF job claim | `print_jobs.by_owner_id_and_status_and_output`; first matching owner/status/output, including legacy printer output |
| Integration grants and identities | Credential/owner indexes; unique or newest 100 grants |
| Link challenges | External-auth hash unique; owner/created-at range with a six-row rate-limit probe |

Uploads are bounded to 100 events and 2 MB of total UTF-8 payload; individual client events retain a 50 KB limit. Normal clients upload 20 events at a time. Server-generated calendar events can be larger, so download queries use byte budgets rather than relying only on a row count.

## Local database coverage

| Read path | Index / treatment |
| --- | --- |
| Event IDs and settings keys | SQLite primary keys |
| Pending upload selection/count | `(uploaded, clock, actor_id)` |
| Workspace replay and maximum Lamport clock | `(clock, actor_id)` |
| Export | Same ordering index; shared domain comparator supplies canonical ID tie-breaking |
| Legacy import | Intentional full-table recovery read, idempotent primary-key insert |
| Print journal unreported attempts | `(reported)`; 100-row batches |
| Print journal interrupted attempts | `(status)` |
| Print journal attempt lookup/reporting | Primary key on `id` |

PowerSync stores row IDs outside its JSON payload. Declaring `id` in an SDK composite index indexed a nonexistent JSON property and left SQLite sorting the last term. Local SQL now orders by the actual indexed payload fields; the workspace projector and export share the canonical clock/actor/ID comparator. PowerSync installs its new indexes when the app opens. Worker journal indexes are installed idempotently at worker startup; no journal or workspace data is cleared.

## Verification

The deployed backend recovered the real schedule on 2026-11-12: its error cleared, that day's PDF reached `rendered`, and the workspace projection returned 94,474 bytes at sequence 783 without a read-limit failure.

- Convex tests enforce actual transaction limits with a history larger than 16 MB. The old indexed read fails at the platform limit; paginated briefing and planning preparation succeed with early and late tasks retained.
- Tests cover pinned revisions, legacy events, edits arriving after a read, duplicate delivery prevention, large sync pages, and owner-scoped interrupted-job recovery.
- Chromium and WebKit execute `EXPLAIN QUERY PLAN` against the real PowerSync database and confirm index use without temporary sorting for upload, replay, next-clock, and pending-count queries.
- SQLite journal tests verify index use and preservation of existing dispatch records during index installation.

References: [Convex pagination](https://docs.convex.dev/database/pagination), [Convex limits](https://docs.convex.dev/production/state/limits). API signatures were also checked against the installed Convex 1.49.0 and PowerSync packages.
