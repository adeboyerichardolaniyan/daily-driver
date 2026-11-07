import { z } from "zod";
import QRCode from "qrcode";
import type { Task } from "./workspace";

export const receiptSchema = z.object({
  version: z.literal(1),
  title: z.string().max(200),
  date: z.string().max(100),
  tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(500),
        minutes: z.number().min(1).max(480),
        doneWhen: z.string().max(2000),
        url: z
          .string()
          .url()
          .refine(
            (url) =>
              new URL(url).protocol === "https:" &&
              !new URL(url).username &&
              !new URL(url).password,
            "Task links require HTTPS",
          ),
      }),
    )
    .min(1)
    .max(100),
});
export type ReceiptSnapshot = z.infer<typeof receiptSchema>;
export function createReceipt(tasks: Task[], baseUrl: string): ReceiptSnapshot {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.hostname === "localhost" ||
    base.hostname === "127.0.0.1"
  )
    throw new Error(
      "Set a public HTTPS app URL so your phone can open the task links.",
    );
  return receiptSchema.parse({
    version: 1,
    title: "One step at a time.",
    date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    tasks: tasks
      .filter(
        (task) =>
          task.today &&
          !task.completed &&
          !task.archived &&
          task.kind === "task",
      )
      .map((task) => ({
        id: task.id,
        title: task.title,
        minutes: task.minutes,
        doneWhen: task.doneWhen,
        url: new URL(
          `/?task=${encodeURIComponent(task.id)}`,
          base.origin,
        ).toString(),
      })),
  });
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export async function renderReceipt(input: ReceiptSnapshot): Promise<string> {
  const snapshot = receiptSchema.parse(input);
  const items = await Promise.all(
    snapshot.tasks.map(async (task) => {
      const qr = await QRCode.toDataURL(task.url, {
        width: 180,
        margin: 3,
        errorCorrectionLevel: "M",
      });
      return `<section><div class="task"><span class="box">□</span><h2>${escape(task.title)}</h2><span>${task.minutes}m</span></div>${task.doneWhen ? `<p>${escape(task.doneWhen)}</p>` : ""}<img src="${qr}" alt="Open task on phone"/><small>Scan to open &amp; complete</small></section>`;
    }),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily briefing</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;color:#000;background:#fff;font:12px Georgia,serif}header{text-align:center;border-bottom:2px solid;padding:12px 0}header span,small{font:9px monospace;letter-spacing:1px}h1{font-size:25px;font-weight:400;margin:12px 0}header p{font:10px monospace}section{padding:16px 0;border-bottom:1px solid;break-inside:avoid}.task{display:flex;gap:8px;align-items:baseline}h2{font-size:15px;flex:1;margin:0}.box{font-size:18px}p{line-height:1.5}img{display:block;width:28mm;height:28mm;margin:8px auto}small{display:block;text-align:center}footer{padding:24px 0;text-align:center;font-style:italic}.notes{height:28mm;border-bottom:1px dotted;margin-top:14px}</style></head><body><header><span>DAILY DRIVER · DAILY NOTES</span><p>${escape(snapshot.date)}</p><h1>${escape(snapshot.title)}</h1></header>${items.join("")}<div class="notes">A little room to think.</div><footer>You only need to start here.</footer></body></html>`;
}
