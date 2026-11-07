import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { receiptSchema, renderReceipt } from "../src/domain/receipt";

const execute = promisify(execFile);
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See docs/stage-one.md.`);
  return value;
};
const url = required("SUPABASE_URL");
const key = required("SUPABASE_PUBLISHABLE_KEY");
const email = required("WORKER_EMAIL");
const password = required("WORKER_PASSWORD");
const printer = required("PRINTER_NAME");
const worker = process.env.WORKER_ID || "workstation-mac-mini";
const directory = resolve(process.env.PRINT_STATE_DIR || ".print-worker");
await mkdir(directory, { recursive: true, mode: 0o700 });
// An exclusive lock on a separate SQLite file releases automatically on crash.
const lock = new DatabaseSync(resolve(directory, "worker-lock.sqlite"));
try {
  lock.exec("BEGIN EXCLUSIVE");
} catch {
  throw new Error("Another worker already uses this state directory.");
}
const journal = new DatabaseSync(resolve(directory, "journal.sqlite"));
journal.exec(
  "CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, reported INTEGER NOT NULL DEFAULT 0)",
);
const client = createClient(url, key, { auth: { persistSession: false } });
const login = await client.auth.signInWithPassword({ email, password });
if (login.error)
  throw new Error("Worker sign-in failed. Check the configured account.");
// No raw socket is exposed. All jobs are obtained over authenticated outbound HTTPS.
if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1:"))
  throw new Error("Worker requires HTTPS (or a local development backend).");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function finish(id: string, status: string, detail: string | null) {
  journal
    .prepare(
      "UPDATE attempts SET status = ?, detail = ?, reported = 0 WHERE id = ?",
    )
    .run(status, detail, id);
  const { error } = await client.rpc("finish_print_job", {
    job: id,
    worker,
    outcome: status,
    detail,
  });
  if (error)
    throw new Error(
      "Could not report print outcome; it is retained in the local journal.",
    );
  journal.prepare("UPDATE attempts SET reported = 1 WHERE id = ?").run(id);
}
async function reconcile() {
  // A worker killed after claim but before journal creation is also uncertain.
  const { data, error } = await client
    .from("print_jobs")
    .select("id")
    .eq("worker_id", worker)
    .eq("status", "processing");
  if (error) throw new Error("Could not load interrupted jobs.");
  for (const job of data ?? [])
    journal
      .prepare(
        "INSERT OR IGNORE INTO attempts(id,status,detail) VALUES (?, 'uncertain', 'Worker stopped before confirming dispatch. Check the printer before reprinting.')",
      )
      .run(job.id);
  journal.exec(
    "UPDATE attempts SET status = 'uncertain', detail = 'Dispatch was interrupted. Check the printer before reprinting.' WHERE status = 'processing'",
  );
  const unreported = journal
    .prepare("SELECT id, status, detail FROM attempts WHERE reported = 0")
    .all();
  for (const row of unreported)
    await finish(
      String(row.id),
      String(row.status),
      row.detail === null ? null : String(row.detail),
    );
}
await reconcile();
console.log(`Print worker ready (${worker}). Waiting for jobs.`);
const browser = await chromium.launch({ headless: true });
try {
  while (!stopping) {
    try {
      const pending = journal
        .prepare("SELECT id, status, detail FROM attempts WHERE reported = 0")
        .all();
      for (const row of pending)
        await finish(
          String(row.id),
          String(row.status),
          row.detail === null ? null : String(row.detail),
        );
      const { data, error } = await client.rpc("claim_print_job", { worker });
      if (error) throw new Error("Could not claim a print job.");
      const job = data?.[0];
      if (job) {
        const existing = journal
          .prepare("SELECT status FROM attempts WHERE id = ?")
          .get(job.id);
        if (existing) {
          await finish(
            job.id,
            String(existing.status),
            "Previously handled job; not dispatched again.",
          );
          continue;
        }
        journal
          .prepare("INSERT INTO attempts(id,status) VALUES (?, 'processing')")
          .run(job.id);
        let dispatchStarted = false;
        const page = await browser.newPage();
        try {
          const snapshot = receiptSchema.parse(job.snapshot);
          // The renderer escapes all text and includes only inline QR images.
          await page.route("**/*", (route) => route.abort());
          await page.setContent(await renderReceipt(snapshot), {
            waitUntil: "load",
          });
          const height = await page.evaluate(() =>
            Math.ceil(document.body.scrollHeight),
          );
          const pdfPath = resolve(directory, `${job.id}.pdf`);
          await page.pdf({
            path: pdfPath,
            width: "80mm",
            height: `${height + 32}px`,
            margin: { top: "4mm", bottom: "4mm", left: "4mm", right: "4mm" },
            printBackground: true,
          });
          await writeFile(
            resolve(directory, `${job.id}.json`),
            JSON.stringify(snapshot),
            { mode: 0o600 },
          );
          // Once lp begins, even a failed/timeout result may have reached CUPS.
          dispatchStarted = true;
          await execute(
            "/usr/bin/lp",
            ["-d", printer, "-o", "fit-to-page", pdfPath],
            { timeout: 30000 },
          );
          await finish(
            job.id,
            "dispatched",
            "Accepted by the local print spooler. Physical output must be checked on the printer.",
          );
          console.log(`Dispatched job ${job.id}.`);
        } catch (error) {
          const outcome = dispatchStarted ? "uncertain" : "failed";
          await finish(
            job.id,
            outcome,
            dispatchStarted
              ? "The spooler may have accepted this job. Check the printer before explicitly reprinting."
              : error instanceof Error
                ? error.message.slice(0, 500)
                : "Receipt rendering failed.",
          );
        } finally {
          await page.close();
        }
      }
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Worker connection failed.",
      );
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
} finally {
  await browser.close();
  await client.auth.signOut();
  journal.close();
  lock.close();
}
