# Briefing editor

Open **Briefings** to edit the receipt alongside a live preview. Add up to 12 sections: today's unfinished task steps, calendar events, custom text, or space for handwritten notes. Rename, remove, and reorder sections with the arrow controls. The heading, closing line, task QR codes, and completion hints are editable.

**Save template** persists through the local workspace event log and syncs when connected. **Discard changes** returns to the latest saved template. Unsaved edits are previewed immediately and are used if you choose Send to Mac mini; save first to reuse those edits later. Leaving the view discards unsaved changes.

Tasks and events use the planning timezone. Task sections show unfinished leaves scheduled for today, in queue order. Calendar sections include events on that date, including all-day events. Text is escaped before rendering. Preview and the print worker share the renderer; queued receipts are immutable snapshots.

Configure `VITE_PUBLIC_APP_URL` with the deployed HTTPS app URL for phone-accessible task QR codes. Without it, the preview uses placeholder QR links and printing is disabled. Existing print-worker setup and authentication are still required to print; restart the worker with the updated checkout so it uses the new renderer.

This increment covers template editing and previews. Automatic daily printing and physical printer verification remain separate work.

Validation: receipt rendering and workspace replay tests; Chromium/WebKit tests for edit, reorder, offline save, reload, discard, and mobile overflow. No physical print was sent during implementation.

## Content collections and the single QR

Open **Briefings → Content collections**. Each collection has its own content type, tone (preset or custom), theme, and Bible translation when applicable. EasyEnglish (EASY) is the initial Bible choice; changing it does not relabel previously saved entries.

Generate 1–30 draft entries with the server-side OpenAI key, or add entries manually. Nothing enters rotation until approved. AI writes original aphorisms, prompts, reminders, or Bible reflections with suggested references. It does not retrieve verified Bible text or attributed quotations. Exact quotations/verses need a source and explicit wording/attribution confirmation in the editor. Translation labels are printed only for quotations; reflections remain labelled as reflections.

Add a **Rotating content** section to the template and select a collection. Approved entries cycle in a deterministic shuffled order without repeating within an unchanged collection's cycle. Drafts are excluded. Changing the approved pool starts a revised rotation for subsequent days. Today's selection is held through entry edits/deletions; **Use today** explicitly replaces it before saving the briefing. The date follows the planning timezone.

**Save today's briefing** freezes the receipt, including its selected content and task list. Reprints use this saved version; later collection edits affect future briefings. The receipt has one QR linking to `/?briefing=YYYY-MM-DD`, where the same signed-in user can see the saved briefing and check off its tasks. Historical content stays unchanged; task completion reflects the current task state. The link contains no credentials. A public HTTPS app URL and workspace sync are required to open it on another device.

**Open saved briefing** opens today's saved receipt in a modal over the editor. Closing it or pressing Escape returns focus to the button and preserves unsaved template edits. Receipt QR links still open the dedicated saved-briefing view.

AI requests queue in the local event log while offline. Missing server keys leave jobs waiting; a one-minute scheduler resumes them when the key becomes available. Attempts have a timeout and stale completions are ignored. Draft generation is tested with mocked model output; live provider output and physical printing still require setup verification.

## Receipt design

The shared renderer follows the Daily Notes reference: reversed masthead, day-of-year issue number, serif headline, daily workload summary, numbered sections, checkbox task rows with dotted duration leaders, calendar time ranges, dotted writing space, featured collection passages, and a single QR footer. Task rows can include their parent task/project, approved scheduled start time, and completion hint. Existing section order, headings, visibility, and saved content are preserved.

The weather position is used for real task minutes and event counts; no weather or other unconnected data is invented. System Georgia and Courier fonts and inline SVG/QR graphics keep preview and worker output self-contained. The content width is 72 mm inside an 80 mm paper width. Old receipt snapshots remain readable; optional date/context fields enrich newly saved ones.

Validated at the physical content width in Chromium and WebKit, including PDF generation and long task titles. Physical printer output remains to be checked on the Mac mini.

Heading and closing line can each use a collection through their source selector. The text field remains the fallback if the collection is removed or has no approved content. Both placements use the same daily selection as body sections; the resolved text and attribution are frozen into the saved briefing. Long collection entries wrap without truncation. Collection setup separates preferences, draft generation, entries, and deletion, with a responsive layout and explicit empty state.

## Weather and live data sections

Content collections lives below the Daily briefing heading, alongside **Open saved briefing** when today's briefing has been saved. Its badge shows the number of collections. **Add section → Weather** adds a city/postal-code search, selectable matching locations, Celsius/Fahrenheit controls, and a manual refresh button. The location is part of the saved template. Open-Meteo forecast/geocoding requests use their public APIs directly; no key or signup is needed for this personal, non-commercial app. See [API documentation](https://open-meteo.com/en/docs), [geocoding](https://open-meteo.com/en/docs/geocoding-api), and [pricing](https://open-meteo.com/en/pricing).

The app refreshes when the weather editor opens with an old cache, every 30 minutes while it remains mounted, and on reconnect. Forecasts sync through the workspace event log. A cache must match the chosen coordinates, units, timezone, and day to be printed. Data older than two hours is explicitly marked cached; previous-day data is omitted. Weather is frozen with the saved receipt. No background refresh is performed when the app is closed. The Mac app permits only the two Open-Meteo HTTPS endpoints through its connection policy.

**Day overview** adds the working window, task estimates, calendar-based task capacity after buffers, and reserved time. Stale calendar data is flagged instead of presenting a capacity estimate. Other data can be supplied using custom text or approved rotating collections. Weather credits are included on screen and on the receipt.
