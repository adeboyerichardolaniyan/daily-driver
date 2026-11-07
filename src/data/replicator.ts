import type { WorkspaceEvent } from "../domain/workspace";
import type { EventStore } from "./event-store";
export interface SyncTransport {
  bootstrap(
    cursor: string | null,
  ): Promise<{
    page: WorkspaceEvent[];
    continueCursor: string;
    isDone: boolean;
  }>;
  upload(events: WorkspaceEvent[]): Promise<unknown>;
  changes(after: number): Promise<(WorkspaceEvent & { sequence: number })[]>;
}
export type SyncStore = Pick<
  EventStore,
  "setting" | "pending" | "acknowledge" | "receive"
>;

// Every checkpoint commits with its data. A crash/retry may replay events but
// cannot skip them. No network operation is on the local editing path.
export class Replicator {
  private stopped = false;
  private running = false;
  private requested = false;
  constructor(
    private store: SyncStore,
    private transport: SyncTransport,
    private report: (error: string | null) => void,
  ) {}
  stop() {
    this.stopped = true;
  }
  async request(): Promise<void> {
    if (this.stopped) return;
    this.requested = true;
    if (this.running) return;
    this.running = true;
    try {
      while (this.requested && !this.stopped) {
        this.requested = false;
        let cursor = await this.store.setting("direct_bootstrap");
        while (cursor !== "done" && !this.stopped) {
          const result = await this.transport.bootstrap(cursor);
          if (this.stopped) return;
          cursor = result.isDone ? "done" : result.continueCursor;
          await this.store.receive(result.page, {
            key: "direct_bootstrap",
            value: cursor,
          });
        }
        while (!this.stopped) {
          const events = await this.store.pending();
          if (!events.length || this.stopped) break;
          await this.transport.upload(events);
          if (this.stopped) return;
          await this.store.acknowledge(events);
        }
        while (!this.stopped) {
          const after = Number(
            (await this.store.setting("direct_cursor")) ?? 0,
          );
          const changes = await this.transport.changes(after);
          if (this.stopped) return;
          const last = changes.at(-1);
          if (!last) break;
          if (last.sequence <= after)
            throw new Error("Sync cursor did not advance.");
          await this.store.receive(changes, {
            key: "direct_cursor",
            value: String(last.sequence),
          });
        }
        if (!this.stopped) this.report(null);
      }
    } catch (error) {
      if (!this.stopped)
        this.report(
          error instanceof Error
            ? error.message
            : "Sync paused. Local work is safe.",
        );
    } finally {
      this.running = false;
    }
  }
}
