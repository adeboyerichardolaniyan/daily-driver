# Deleting workspace objects

Tasks and projects have Delete in their action menu and edit dialog. Project/task deletion includes its current descendants, with the count shown before confirmation. The same behavior is available from Settings & connections → Manage data.

Manage data includes tasks/projects, AI drafts (including approved history), daily plans, saved briefings, collections, individual entries, calendar subscriptions, imported event occurrences, receipt sections, weather location/cache, content-generation history and the current focus session. Search and category filtering keep large workspaces manageable.

Deletion requires confirmation. Local workspace deletions work offline and sync on reconnection. Task UUIDs and collection/entry IDs use delete-wins tombstones: edits and late results do not recreate them. Deleting a task clears its active focus and removes references from plan blocks. A child moved out before deletion is retained; children explicitly included in deletion cannot escape it through a late edit.

Deleting approved draft/plan history keeps the tasks and schedules already produced by that approval. New calendar snapshots respect deleted occurrence IDs. Removing an imported calendar event affects Daily Driver only, including its availability calculation; it does not change Google or Outlook. Disconnecting a calendar requires a network connection.

A saved briefing uses its date as its key. Deleting it removes the saved phone view; explicitly saving a new briefing for that date creates a replacement. Deleting cached weather allows a later refresh. Recurring planning/delivery settings continue to operate until disabled.

In Briefings → Delivery activity, deleting a queued job cancels it; finished jobs can be removed from the list. A print job already processing cannot be deleted until the worker finishes. Job IDs are retained as tombstones to prevent stale retries from printing again. Removing delivery activity does not delete files on the Mac mini or physical receipts.

These are workspace removals, not privacy erasure: event history and prior immutable snapshots remain in local/cloud history, and exports can include deleted content. No bulk purge, account deletion, or backup erasure is implied.

Verification: deletion convergence/cascade tests; preservation of approved task output; receipt re-save; calendar refresh; cancellation and print replay prevention; confirmation/cancellation/editor/manager browser flows in Chromium and WebKit.
