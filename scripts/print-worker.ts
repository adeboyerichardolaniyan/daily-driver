import { workerConnection, connectionMessage } from "./worker-connection";
import { api } from "../convex/_generated/api";
import { DatabaseSync } from "node:sqlite";
import { initializePrintJournal } from "./print-journal";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { receiptSchema } from "../src/domain/receipt";
import {
  checkPrinter,
  printerProfile,
  printArguments,
  renderReceiptFile,
  receiptFilePath,
} from "./printer-output";

process.umask(0o077);
const execute = promisify(execFile);
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See docs/stage-one.md.`);
  return value;
};
const { client, secret, worker } = workerConnection();
const output = process.env.PRINT_MODE || "pdf";
if (output !== "pdf" && output !== "printer")
  throw new Error("PRINT_MODE must be pdf or printer.");
const printer = output === "printer" ? required("PRINTER_NAME") : "";
const profile = printerProfile(process.env.PRINTER_PROFILE);
if (output === "printer") await checkPrinter(printer);
const directory = resolve(process.env.PRINT_STATE_DIR || ".print-worker");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
// An exclusive lock on a separate SQLite file releases automatically on crash.
const lock = new DatabaseSync(resolve(directory, "worker-lock.sqlite"));
try {
  lock.exec("BEGIN EXCLUSIVE");
} catch {
  throw new Error("Another worker already uses this state directory.");
}
const journal = new DatabaseSync(resolve(directory, "journal.sqlite"));
initializePrintJournal(journal);
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
  if (
    status !== "dispatched" &&
    status !== "rendered" &&
    status !== "failed" &&
    status !== "uncertain"
  )
    throw new Error("Invalid journal outcome.");
  await client.mutation(api.printing.finish, {
    secret,
    id,
    worker,
    outcome: status,
    detail,
  });
  journal.prepare("UPDATE attempts SET reported = 1 WHERE id = ?").run(id);
}
async function reconcile() {
  journal.exec(
    "UPDATE attempts SET status = 'uncertain', detail = 'Dispatch was interrupted. Check the printer before reprinting.' WHERE status = 'processing'",
  );
  // Drain bounded server batches before claiming any new physical work.
  while (true) {
    const data = await client.query(api.printing.interrupted, {
      secret,
      worker,
    });
    if (!data.length) break;
    for (const job of data) {
      journal
        .prepare(
          "INSERT OR IGNORE INTO attempts(id,status,detail) VALUES (?, 'uncertain', 'Worker stopped before confirming dispatch. Check the printer before reprinting.')",
        )
        .run(job.id);
      const row = journal
        .prepare("SELECT status, detail FROM attempts WHERE id = ?")
        .get(job.id)!;
      await finish(
        job.id,
        String(row.status),
        row.detail === null ? null : String(row.detail),
      );
    }
  }
  while (true) {
    const unreported = journal
      .prepare(
        "SELECT id, status, detail FROM attempts WHERE reported = 0 LIMIT 100",
      )
      .all();
    if (!unreported.length) break;
    for (const row of unreported)
      await finish(
        String(row.id),
        String(row.status),
        row.detail === null ? null : String(row.detail),
      );
  }
}

try {
  await reconcile();
} catch (error) {
  journal.close();
  lock.close();
  console.error(`Worker startup failed: ${connectionMessage(error, secret)}`);
  process.exit(1);
}
console.log(
  `Print worker ready (${worker}). ${output} mode. Waiting for jobs.`,
);
try {
  while (!stopping) {
    try {
      const pending = journal
        .prepare(
          "SELECT id, status, detail FROM attempts WHERE reported = 0 LIMIT 100",
        )
        .all();
      for (const row of pending)
        await finish(
          String(row.id),
          String(row.status),
          row.detail === null ? null : String(row.detail),
        );
      const job = await client.mutation(api.printing.claim, {
        secret,
        worker,
        output,
      });
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
        try {
          const snapshot = receiptSchema.parse(job.snapshot);
          const pdfPath = receiptFilePath(directory, job.id, "pdf");
          await renderReceiptFile(snapshot, pdfPath, profile);
          await writeFile(
            receiptFilePath(directory, job.id, "json"),
            JSON.stringify(snapshot),
            { mode: 0o600 },
          );
          if (output === "pdf") {
            await finish(
              job.id,
              "rendered",
              "PDF saved on the worker. Nothing was sent to a printer.",
            );
            console.log(`Saved PDF ${pdfPath}.`);
            continue;
          }
          // Once lp begins, even a failed/timeout result may have reached CUPS.
          dispatchStarted = true;
          await execute("/usr/bin/lp", printArguments(printer, pdfPath), {
            timeout: 30000,
          });
          await finish(
            job.id,
            "dispatched",
            "Accepted by the local print spooler. Physical output must be checked on the printer.",
          );
          console.log(`Dispatched job ${job.id}.`);
        } catch (error) {
          // A reporting failure must not overwrite a durable terminal outcome.
          // Reconciliation will resend that same outcome on the next loop.
          const recorded = journal
            .prepare("SELECT status FROM attempts WHERE id = ?")
            .get(job.id);
          if (recorded && recorded.status !== "processing") throw error;
          const outcome = dispatchStarted ? "uncertain" : "failed";
          await finish(
            job.id,
            outcome,
            dispatchStarted
              ? "The spooler may have accepted this job. Check the printer before explicitly reprinting."
              : error instanceof Error
                ? connectionMessage(error, secret).slice(0, 500)
                : "Receipt rendering failed.",
          );
        }
      }
    } catch (error) {
      console.error(connectionMessage(error, secret));
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
} finally {
  journal.close();
  lock.close();
}
