import { createReceipt, type ReceiptSnapshot } from "@/domain/receipt";
import type { Task } from "@/domain/workspace";
import { api } from "../../convex/_generated/api";
import { connectedClient, convex } from "./sync";
export type PrintJob = {
  id: string;
  status: string;
  created_at: string;
  error: string | null;
};
export async function queueReceipt(tasks: Task[]): Promise<string> {
  return queueSnapshot(
    createReceipt(tasks, import.meta.env.VITE_PUBLIC_APP_URL || ""),
  );
}
export async function queueSnapshot(snapshot: ReceiptSnapshot) {
  return connectedClient().mutation(api.printing.enqueue, {
    id: crypto.randomUUID(),
    snapshot: JSON.stringify(snapshot),
  });
}
export async function getPrintJobs(): Promise<PrintJob[]> {
  if (!convex) return [];
  return connectedClient().query(api.printing.list, {});
}

export async function deletePrintJob(id: string) {
  return connectedClient().mutation(api.printing.remove, { id });
}
