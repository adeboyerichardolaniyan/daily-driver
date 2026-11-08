# Calendar-aware daily planning

## Using it

1. Open **Settings & connections → Daily planning**. Set timezone (IANA name), working hours/days, evening planning time, appointment buffer, and minutes to leave free. Save preferences. Enable **Prepare plans automatically** for background suggestions. Settings edits save offline and sync on reconnect.
2. Under **Calendars**, add a name and a Google secret iCal address or Outlook published ICS URL. URLs remain in the owner-protected Convex table; they are not returned in workspace sync or exports. External calendars are read-only.
3. On **Today**, choose Today or Tomorrow and **Prepare plan**. Review proposed times, deselect unwanted steps, and approve. Unselected tasks stay where they are. Stale proposals require a fresh plan.
4. Switch Today to **Calendar** to see imported appointments and approved task times. External event times use the planning timezone.

Default settings are 09:00–17:00, Monday–Friday, evening planning at 19:00, a 10-minute appointment buffer, and 60 minutes of unscheduled capacity. Automatic planning is opt-in. The initial timezone is America/New_York; change it in Settings when needed.

## Behavior

- Calendar refresh runs every 15 minutes and supports manual refresh (one-minute cooldown). Providers may publish changes more slowly. Failed refreshes preserve the last good snapshot and display an error.
- Imports cover yesterday through roughly 46 days ahead. Recurrence rules, exception dates, moved occurrences, cancellations, exclusive all-day end dates, floating local times, and DST are handled by node-ical plus explicit planning-timezone conversion. Transparent events do not block time. All-day busy events can be configured to block or not block the workday.
- Available time merges overlapping commitments, applies appointment buffers, and subtracts reserved free minutes. Tasks must fit a continuous window; tasks are never silently shortened.
- AI ranks existing unfinished leaf tasks. Deterministic fitting checks IDs, durations, busy time, and capacity, retains valid approved slots, and avoids rescheduling the active focus task. Plans begin at least five minutes in the future to allow review.
- Background planning runs every 15 minutes: today during working hours, tomorrow after the selected evening time. Changed task/calendar/settings input can produce a new suggestion. Overrunning focus sessions can prompt a revision after 30 minutes. Approved tasks never move automatically.
- Approval can include all or selected steps. The local event projector verifies input freshness, passed times, calendar freshness, and collisions with retained approved steps. Duplicate approvals are idempotent. Approved fields are ordinary scheduled task data and sync to every device.
- OpenAI uses the existing server-side `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-4.1-mini`) through `@convex-dev/agent`. Free-tier Convex uses the direct provider. Requests wait for a missing key and resume from the background job. Agent threads retain generation history. Provider failures surface a retryable issue; they do not change tasks.

## Limits and validation

Google/Outlook HTTPS subscription hosts only; no arbitrary URL fetches. Ten sources per workspace, a 2 MB feed fetch limit, 2,000 expanded occurrences and 600 KB of normalized event data per source. Oversized/invalid feeds retain their prior snapshot and show a refresh error. Snapshots older than two hours, from an old planning timezone, or outside the date coverage prevent approval. Planning considers up to 100 task candidates per generation; workspace history above 10,000 events needs compaction before more planning. These bounds are explicit and can be extended with pagination/materialization later.

Tests cover DST, recurrence exceptions, cancellation, floating times, all-day boundaries, overlapping busy time, reserve capacity, retained approved slots, stale approvals, duplicate actions, authorization, feed URL secrecy, failed refresh retention, evening scheduling, mocked agent generation, editable settings, offline persistence, imported-event display, and selective approval. Real Google/Outlook feeds require the owner's subscription links. Automated generation tests use a mocked agent response, not paid model calls.

Sources: [Google iCal setup](https://support.google.com/calendar/answer/37648), [Outlook calendar publishing](https://learn.microsoft.com/en-us/exchange/sharing/publish-subscribe-calendars), [node-ical](https://github.com/jens-maus/node-ical), [Convex Agent](https://docs.convex.dev/agents/getting-started).
