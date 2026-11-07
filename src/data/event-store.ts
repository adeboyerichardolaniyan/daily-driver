import type { WorkspaceEvent } from "../domain/workspace";

type Params = (string | number | null)[];
export interface LocalSession {
  execute(sql: string, params?: Params): Promise<unknown>;
  getOptional<T>(sql: string, params?: Params): Promise<T | null>;
}
export interface LocalDatabase extends LocalSession {
  getAll<T>(sql: string, params?: Params): Promise<T[]>;
  writeTransaction<T>(work: (tx: LocalSession) => Promise<T>): Promise<T>;
}
export async function initializeEventStore(db: LocalDatabase) {
  // Retain the legacy table and its queue as a recovery copy. Import any old
  // window's late writes on the next launch, without overwriting current flags.
  await db.execute(`INSERT OR IGNORE INTO event_log (id, actor_id, clock, created_at, payload, uploaded)
    SELECT id, actor_id, clock, created_at, payload, 0 FROM workspace_events`);
}
export class EventStore {
  constructor(private db: LocalDatabase) {}
  async bind(identity: string) {
    await this.db.writeTransaction(async (tx) => {
      const current = await tx.getOptional<{ value: string }>(
        "SELECT value FROM local_settings WHERE id = 'account'",
      );
      if (current && current.value !== identity)
        throw new Error(
          "This local workspace belongs to another account or deployment. Your local history has been retained.",
        );
      await tx.execute(
        "INSERT OR IGNORE INTO local_settings (id, value) VALUES ('account', ?)",
        [identity],
      );
    });
  }
  async setting(key: string) {
    return (
      (
        await this.db.getOptional<{ value: string }>(
          "SELECT value FROM local_settings WHERE id = ?",
          [key],
        )
      )?.value ?? null
    );
  }
  async pending(): Promise<WorkspaceEvent[]> {
    return this.db.getAll(
      "SELECT id, actor_id, clock, created_at, payload FROM event_log WHERE uploaded = 0 ORDER BY clock, actor_id, id LIMIT 20",
    );
  }
  async acknowledge(events: WorkspaceEvent[]) {
    await this.db.writeTransaction(async (tx) => {
      for (const event of events)
        await tx.execute("UPDATE event_log SET uploaded = 1 WHERE id = ?", [
          event.id,
        ]);
    });
  }
  async receive(
    events: WorkspaceEvent[],
    checkpoint?: { key: string; value: string },
  ) {
    await this.db.writeTransaction(async (tx) => {
      for (const e of events) {
        const old = await tx.getOptional<WorkspaceEvent>(
          "SELECT * FROM event_log WHERE id = ?",
          [e.id],
        );
        if (
          old &&
          (old.actor_id !== e.actor_id ||
            old.clock !== e.clock ||
            old.created_at !== e.created_at ||
            old.payload !== e.payload)
        )
          throw new Error("Conflicting event ID. Local history was retained.");
        await tx.execute(
          "INSERT OR IGNORE INTO event_log (id, actor_id, clock, created_at, payload, uploaded) VALUES (?, ?, ?, ?, ?, 1)",
          [e.id, e.actor_id, e.clock, e.created_at, e.payload],
        );
        await tx.execute("UPDATE event_log SET uploaded = 1 WHERE id = ?", [
          e.id,
        ]);
      }
      if (checkpoint) {
        // Two windows can download simultaneously. Never move a cursor backward.
        if (checkpoint.key === "direct_cursor") {
          const old = await tx.getOptional<{ value: string }>(
            "SELECT value FROM local_settings WHERE id = ?",
            [checkpoint.key],
          );
          if (Number(old?.value ?? 0) > Number(checkpoint.value)) return;
        }
        await tx.execute(
          "INSERT OR REPLACE INTO local_settings (id, value) VALUES (?, ?)",
          [checkpoint.key, checkpoint.value],
        );
      }
    });
  }
}
