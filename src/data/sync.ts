import { useSyncExternalStore } from "react";
import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import { db } from "./database";
import { EventStore } from "./event-store";
import { Replicator } from "./replicator";

const url = import.meta.env.VITE_CONVEX_URL;
export const syncConfigured = Boolean(url);
export const convex = syncConfigured ? new ConvexReactClient(url) : null;
type Connection = {
  account: string | null;
  connected: boolean;
  error: string | null;
};
let connection: Connection = { account: null, connected: false, error: null };
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
export function attachSync(authenticated: boolean) {
  let disposed = false;
  const abort = new AbortController();
  const cleanups: (() => void)[] = [];
  let replicator: Replicator | undefined;
  publish({ account: null, connected: false, error: null });
  const client = convex;
  if (authenticated && client) {
    const start = async () => {
      const account = await client.query(api.workspace.account, {});
      if (disposed) return;
      const store = new EventStore(db);
      await store.bind(`convex:${url}:${account.id}`);
      if (disposed) return;
      const report = (error: string | null) => {
        if (!disposed)
          publish({
            account: account.label,
            connected: client.connectionState().isWebSocketConnected && !error,
            error,
          });
      };
      replicator = new Replicator(
        store,
        {
          bootstrap: (cursor) =>
            client.query(api.workspace.bootstrapPage, {
              paginationOpts: { cursor, numItems: 50 },
            }),
          upload: (events) =>
            client.mutation(api.workspace.appendEvents, { events }),
          changes: (after) => client.query(api.workspace.changes, { after }),
        },
        report,
      );
      const request = () => {
        void replicator?.request();
      };
      const watch = client.watchQuery(api.workspace.head, {});
      cleanups.push(
        watch.onUpdate(() => {
          try {
            watch.localQueryResult();
            request();
          } catch (error) {
            report(
              error instanceof Error ? error.message : "Sync unavailable.",
            );
          }
        }),
      );
      cleanups.push(
        client.subscribeToConnectionState((state) => {
          if (!disposed)
            publish({
              ...connection,
              connected: state.isWebSocketConnected && !connection.error,
            });
          if (state.isWebSocketConnected) request();
        }),
      );
      db.watch(
        "SELECT COUNT(*) AS pending FROM event_log WHERE uploaded = 0",
        [],
        { onResult: request, onError: (error) => report(String(error)) },
        { signal: abort.signal },
      );
      // Retry temporary failures and cover missed notification races. The normal
      // path is event-driven; this fallback does not read the full history.
      const retry = setInterval(request, 30000);
      cleanups.push(() => clearInterval(retry));
      report(null);
      request();
    };
    void start().catch((error) => {
      if (!disposed)
        publish({
          account: null,
          connected: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not connect sync. Local work is safe.",
        });
    });
  }
  return () => {
    disposed = true;
    replicator?.stop();
    abort.abort();
    cleanups.forEach((cleanup) => cleanup());
    publish({ account: null, connected: false, error: null });
  };
}
