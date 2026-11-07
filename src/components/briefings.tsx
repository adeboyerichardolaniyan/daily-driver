import { useState } from "react";
import { Printer, RefreshCw, FileText, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Task } from "@/domain/workspace";
import { createReceipt, renderReceipt } from "@/domain/receipt";
import { getPrintJobs, queueReceipt, type PrintJob } from "@/data/printing";

export function Briefings({
  tasks,
  run,
}: {
  tasks: Task[];
  run: (work: () => Promise<unknown>) => void;
}) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const printable = tasks.filter(
    (task) =>
      task.today && !task.completed && !task.archived && task.kind === "task",
  );
  return (
    <div className="briefing-layout">
      <div className="briefing-copy">
        <span className="eyebrow">FROM SCREEN TO PAPER</span>
        <h2>
          A small plan.
          <br />
          Something you can hold.
        </h2>
        <p>
          Print today's unfinished steps, with a QR code to open each one on
          your phone.
        </p>
        <div className="briefing-buttons">
          <Button
            disabled={busy || !printable.length}
            onClick={() => {
              setBusy(true);
              run(async () => {
                try {
                  await queueReceipt(tasks);
                  setJobs(await getPrintJobs());
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            <Printer />
            {busy ? "Sending…" : "Send to Mac mini"}
          </Button>
          <Button
            variant="outline"
            disabled={!printable.length}
            onClick={() =>
              run(async () => {
                setHtml(
                  await renderReceipt(
                    createReceipt(
                      tasks,
                      import.meta.env.VITE_PUBLIC_APP_URL ||
                        "https://example.invalid",
                    ),
                  ),
                );
              })
            }
          >
            <FileText />
            Preview receipt
          </Button>
        </div>
        <p className="setup-note">
          Manual printing is available in this foundation. Scheduled briefings
          and the visual template editor come next.
        </p>
        <div className="print-history">
          <div className="section-heading">
            <h3>Print activity</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh print activity"
              onClick={() => run(async () => setJobs(await getPrintJobs()))}
            >
              <RefreshCw />
            </Button>
          </div>
          {jobs.length ? (
            jobs.map((job) => (
              <div key={job.id} className="print-job">
                <span>{new Date(job.created_at).toLocaleString()}</span>
                <strong>{job.status}</strong>
                {job.error && <p>{job.error}</p>}
              </div>
            ))
          ) : (
            <p>Refresh to check for queued jobs.</p>
          )}
        </div>
      </div>
      <div className="receipt-stage">
        {html ? (
          <>
            <iframe title="Receipt preview" sandbox="" srcDoc={html} />
            <small>Preview only · QR links need your public app URL</small>
          </>
        ) : (
          <div className="paper-placeholder">
            <div className="paper-brand">DAILY DRIVER</div>
            <p>DAILY NOTES</p>
            <h3>
              One step
              <br />
              at a time.
            </h3>
            <div className="paper-divider" />
            {printable.slice(0, 5).map((task) => (
              <div className="paper-task" key={task.id}>
                <span>□</span>
                {task.title}
              </div>
            ))}
            {!printable.length && <p>Add a task to today to begin.</p>}
            <div className="paper-divider" />
            <ArrowUpRight size={20} />
            <em>A little progress goes a long way.</em>
          </div>
        )}
      </div>
    </div>
  );
}
