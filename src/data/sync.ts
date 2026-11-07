import { useSyncExternalStore } from "react";
import { ConvexReactClient } from "convex/react";
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
} from "@powersync/common";
import { api } from "../../convex/_generated/api";
import { db } from "./database";

const url = import.meta.env.VITE_CONVEX_URL;
const endpoint = import.meta.env.VITE_POWERSYNC_URL;
export const syncConfigured = Boolean(url && endpoint);
export const convex = syncConfigured ? new ConvexReactClient(url) : null;

export class Connector implements PowerSyncBackendConnector {
  constructor(
    private client: ConvexReactClient,
    private token: string,
  ) {}
  async fetchCredentials() {
    const segment = this.token.split(".")[1];
    if (!segment)
      throw new Error("The sync session token is invalid. Sign in again.");
    const payload: unknown = JSON.parse(
      atob(segment.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      !payload ||
      typeof payload !== "object" ||
      !("exp" in payload) ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp)
    )
      throw new Error(
        "The sync session has no valid expiration. Sign in again.",
      );
    return {
      endpoint,
      token: this.token,
      expiresAt: new Date(payload.exp * 1000),
    };
  }
  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const events = transaction.crud.map((op) => {
      if (op.table !== "workspace_events" || op.op !== "PUT")
        throw new Error("Unexpected write: event history is append-only.");
      const fields = op.opData;
      if (
        !fields ||
        typeof fields.actor_id !== "string" ||
        typeof fields.clock !== "number" ||
        typeof fields.created_at !== "string" ||
        typeof fields.payload !== "string"
      )
        throw new Error(
          "Invalid queued event. Local history has been retained.",
        );
      return {
        id: op.id,
        actor_id: fields.actor_id,
        clock: fields.clock,
        created_at: fields.created_at,
        payload: fields.payload,
      };
    });
    await this.client.mutation(api.workspace.appendEvents, { events });
    // Never acknowledge rejected uploads: preserve the local queue for recovery.
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
export function connectedClient() {
  if (!convex || !connection.account)
    throw new Error("Connect your workspace before printing.");
  return convex;
}

// Serialize external connection changes so a late authentication result cannot
// connect the database after sign-out, token refresh, or React effect cleanup.
let lifecycle = Promise.resolve();
export function attachSync(token: string | null, authenticated: boolean) {
  let disposed = false;
  lifecycle = lifecycle
    .then(async () => {
      await db.disconnect();
      publish({ account: null, error: null });
      if (disposed || !token || !authenticated || !convex) return;
      const account = await convex.query(api.workspace.account, {});
      if (disposed) return;
      const identity = `convex:${url}:${account.id}`;
      await db.writeTransaction(async (tx) => {
        const current = await tx.getOptional<{ value: string }>(
          "SELECT value FROM local_settings WHERE id = ?",
          ["account"],
        );
        if (current && current.value !== identity)
          throw new Error(
            "This local workspace belongs to a different account or deployment. Use the original connection; your local history has not been removed.",
          );
        await tx.execute(
          "INSERT OR IGNORE INTO local_settings (id, value) VALUES (?, ?)",
          ["account", identity],
        );
      });
      if (disposed) return;
      await db.connect(new Connector(convex, token));
      if (!disposed) publish({ account: account.label, error: null });
    })
    .catch((error) => {
      if (!disposed)
        publish({
          account: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not connect sync. Local work is still available.",
        });
    });
  return () => {
    disposed = true;
    lifecycle = lifecycle
      .then(async () => {
        await db.disconnect();
        publish({ account: null, error: null });
      })
      .catch(() => {});
  };
}
