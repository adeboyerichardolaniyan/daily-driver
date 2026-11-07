import { useSyncExternalStore } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
} from "@powersync/common";
import { db } from "./database";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const endpoint = import.meta.env.VITE_POWERSYNC_URL;
export const syncConfigured = Boolean(url && key && endpoint);
export const supabase: SupabaseClient | null = syncConfigured
  ? createClient(url, key)
  : null;

class Connector implements PowerSyncBackendConnector {
  constructor(private client: SupabaseClient) {}
  async fetchCredentials() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Sign in to connect your devices.");
    return {
      endpoint,
      token: data.session.access_token,
      expiresAt: new Date(data.session.expires_at! * 1000),
    };
  }
  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const events = transaction.crud.map((op) => {
      if (op.table !== "workspace_events" || op.op !== "PUT")
        throw new Error("Unexpected write: event history is append-only.");
      return { id: op.id, ...op.opData };
    });
    const { error } = await this.client.rpc("append_workspace_events", {
      events,
    });
    if (error) throw error;
    await transaction.complete();
  }
}

type Connection = { account: string | null; error: string | null };
let connection: Connection = { account: null, error: null };
const listeners = new Set<() => void>();
function publish(value: Connection) {
  connection = value;
  listeners.forEach((listener) => listener());
}
export function useConnection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => connection,
  );
}
export function startSync() {
  void connectSync().catch((error) =>
    publish({
      account: null,
      error:
        error instanceof Error
          ? error.message
          : "Could not connect sync. Local work is still available.",
    }),
  );
}

export async function connectSync(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  const userId = data.session.user.id;
  const bound = await db.getOptional<{ value: string }>(
    "SELECT value FROM local_settings WHERE id = ?",
    ["account"],
  );
  if (!bound) {
    const membership = await supabase
      .from("app_members")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (membership.error || !membership.data)
      throw new Error(
        "This account has not been granted access to the workspace.",
      );
  }
  await db.writeTransaction(async (tx) => {
    const current = await tx.getOptional<{ value: string }>(
      "SELECT value FROM local_settings WHERE id = ?",
      ["account"],
    );
    if (current && current.value !== userId)
      throw new Error(
        "This local workspace belongs to a different account. Sign back into the original account.",
      );
    await tx.execute(
      "INSERT OR IGNORE INTO local_settings (id, value) VALUES (?, ?)",
      ["account", userId],
    );
  });
  await db.connect(new Connector(supabase));
  const account = data.session.user.email ?? userId;
  publish({ account, error: null });
  return account;
}

export async function signIn(email: string, password: string) {
  if (!supabase)
    throw new Error("Sync is not configured. See docs/stage-one.md.");
  // Check the identity before writing credentials into the shared session store.
  const probe = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  const bound = await db.getOptional<{ value: string }>(
    "SELECT value FROM local_settings WHERE id = ?",
    ["account"],
  );
  if (bound && bound.value !== data.user.id)
    throw new Error("Use the account already connected to this workspace.");
  const result = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (result.error) throw result.error;
  return connectSync();
}
