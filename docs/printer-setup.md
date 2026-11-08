# Printer setup

Daily Driver uses a macOS CUPS print queue for both supported profiles:

- `rongta-80`: Rongta 80 mm, connected by USB or Ethernet.
- `netumscan-8360`: NetumScan 8360, connected by USB.

Both render the same 80 mm PDF. The profile identifies your hardware; the installed macOS driver controls paper length and cutting. These are integration targets, not physically certified devices. Exact driver compatibility must be checked when the printer arrives.

## Before buying a printer

Run `npm run print:preview`. This writes `.print-worker/preview.pdf` without credentials, cloud access, or consuming print jobs. The sample QR uses a placeholder URL. To test a saved receipt snapshot instead, run `npm run print:preview -- /absolute/path/to/receipt.json`.

Test the other profile with `PRINTER_PROFILE=netumscan-8360 npm run print:preview`. Install the renderer if needed with `npx playwright install chromium`.

## When the printer arrives

1. Install its current macOS driver and add it in System Settings → Printers & Scanners. For Rongta, either USB or a network queue can be used. NetumScan 8360 uses USB.
2. Run `lpstat -p` to find the exact queue name.
3. Create a private `.env.worker` on the Mac mini with:

```dotenv
CONVEX_URL=https://your-deployment.convex.cloud
PRINT_WORKER_SECRET=your-worker-secret
WORKER_ID=workstation-mac-mini
PRINT_MODE=printer
PRINTER_PROFILE=rongta-80
PRINTER_NAME=your_macos_queue_name
PRINT_STATE_DIR=/absolute/persistent/path/to/print-state
```

Choose `netumscan-8360` instead if buying that model. Set the same worker secret in the Convex environment; follow the worker authorization setup in [stage one](stage-one.md). Restrict the local file with `chmod 600 .env.worker`.

4. Set the driver's default paper to 80 mm receipt roll, and enable cutting if its settings expose that option. Vendor option names differ; the worker does not send guessed cutter commands.
5. Run `npm run print:check`. This checks that macOS recognizes the queue without printing. It does not certify that the device is online or has paper.
6. Run `npm run print:worker`, then queue one receipt in Briefings. Check width, QR readability, length, and cutting before enabling unattended use.

The worker checks the queue before claiming jobs, keeps a durable SQLite dispatch journal, and does not automatically resend an uncertain job. A successful dispatch means CUPS accepted the document, not that paper physically emerged. Switching printers does not reset the journal or replay previous receipts. Keep the same state directory and worker ID.

PDF preview mode is deliberately separate from the live queue: trying layouts before buying hardware cannot mark real print jobs as dispatched.

Automatic preparation and login startup are described below.

## Automatic daily delivery

In **Briefings → Daily delivery**, enable automatic preparation, choose a time and **PDF only**, and save the schedule. It uses the timezone from planning settings and the saved receipt template. Enter your public HTTPS app URL for working QR links; PDF testing can use a placeholder.

Convex checks due schedules every minute while the app is closed. If the chosen time has passed, enabling it prepares today's briefing on the next check. It does not backfill previous days. A saved daily briefing is reused. Otherwise it captures current approved tasks and calendar data, refreshes weather, and selects approved collection content for the day. AI drafts remain unapproved. Weather failures keep same-day cached weather when available and show a delivery warning. Calendar subscriptions retain their existing 15-minute background refresh cadence.

The snapshot and one output job are saved atomically. Repeated ticks, action retries, changing the time, or toggling the schedule do not produce another automatic job for that day. Explicit manual reprints are separate. Preparation failures retry after 15 minutes; an interrupted preparation can recover after five minutes.

Set `PRINT_MODE=pdf` in `.env.worker` (this is also the default) and run `npm run print:worker`. No `PRINTER_NAME` is required in this mode. The worker downloads queued PDF jobs and saves `<job-id>.pdf` plus the snapshot JSON in its state directory. **Print activity → PDF saved** confirms rendering, not physical printing. The cloud saves the briefing even when the mini is offline; PDF creation waits for the mini to reconnect. Neither the app nor a browser must remain open.

When hardware arrives, configure the printer as described above, choose **Receipt printer** in Daily delivery, and set `PRINT_MODE=printer` on the mini. Restart the worker. PDF and printer workers claim only their own output type; changing modes never silently prints earlier PDF jobs. Manual **Send to Mac mini** jobs require printer mode.

## Start the worker automatically on the Mac mini

On the mini, keep this checkout, Node, installed dependencies, Chromium, and `.env.worker` at stable paths. Use an absolute persistent `PRINT_STATE_DIR`. Then run:

```sh
npm run print:service -- install
```

This installs a per-user macOS LaunchAgent and starts it immediately. It runs again at login and restarts after a crash, with a 60-second throttle. It is not a system boot daemon: the user must log in, and a sleeping mini cannot render or print. Cloud preparation continues regardless.

`npm run print:service` only generates and validates a plist for inspection; it does not install it. Logs are in `~/Library/Logs/DailyDriver`. To restart after editing `.env.worker`, run `npm run print:service -- stop`, then `npm run print:service -- install`. To uninstall, stop it and remove `~/Library/LaunchAgents/com.dailydriver.print-worker.plist`.

Worker secrets are read from the private environment file, never embedded in the plist. Re-run installation if the checkout or Node executable moves. Keep only one worker process per state directory; the SQLite lock rejects duplicates.

## Recovering a closed browser

The worker now launches Chromium for each receipt and retries rendering once with a fresh browser. It never retries physical dispatch automatically. Update an existing mini installation by stopping the service, extracting the latest worker bundle over the existing folder (the bundle excludes `.env.worker` and state), and reinstalling the service.

An administrator can recover a confirmed failed PDF using the internal `printing:retryFailedPdf` mutation. This creates a new job ID, preserving the old journal entry, and repeated calls return the same retry ID. It refuses physical output and uncertain jobs. Do not delete the SQLite journal to retry a receipt.
