import { createReceipt, type ReceiptSnapshot } from "@/domain/receipt";
import type { Task } from "@/domain/workspace";
import { supabase } from "./sync";
export type PrintJob = {
  id: string;
  status: string;
  created_at: string;
  error: string | null;
};
export async function queueReceipt(tasks: Task[]): Promise<string> {
  if (!supabase)
    throw new Error("Connect sync before sending a briefing to your Mac mini.");
  const snapshot = createReceipt(
    tasks,
    import.meta.env.VITE_PUBLIC_APP_URL || "",
  );
  return queueSnapshot(snapshot);
}
export async function queueSnapshot(snapshot: ReceiptSnapshot) {
  if (!supabase) throw new Error("Sync is not configured.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in before printing.");
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("print_jobs")
    .insert({ id, owner_id: user.id, snapshot, status: "queued" });
  if (error) throw error;
  return id;
}
export async function getPrintJobs(): Promise<PrintJob[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("print_jobs")
    .select("id,status,created_at,error")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}
