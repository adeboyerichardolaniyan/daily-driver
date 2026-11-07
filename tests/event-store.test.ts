import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  EventStore,
  initializeEventStore,
  type LocalDatabase,
} from "../src/data/event-store";
import type { WorkspaceEvent } from "../src/domain/workspace";
const opened: DatabaseSync[] = [];
afterEach(() => opened.splice(0).forEach((db) => db.close()));
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  opened.push(sqlite);
  sqlite.exec(`CREATE TABLE workspace_events (id TEXT PRIMARY KEY, actor_id TEXT, clock INTEGER, created_at TEXT, payload TEXT);
    CREATE TABLE event_log (id TEXT PRIMARY KEY, actor_id TEXT, clock INTEGER, created_at TEXT, payload TEXT, uploaded INTEGER);
    CREATE TABLE local_settings (id TEXT PRIMARY KEY, value TEXT);`);
  const db: LocalDatabase = {
    execute: async (sql, params = []) => sqlite.prepare(sql).run(...params),
    getOptional: async <T>(
      sql: string,
      params: (string | number | null)[] = [],
    ) => (sqlite.prepare(sql).get(...params) ?? null) as T | null,
    getAll: async <T>(sql: string, params: (string | number | null)[] = []) =>
      sqlite.prepare(sql).all(...params) as T[],
    writeTransaction: async (work) => {
      sqlite.exec("BEGIN");
      try {
        const result = await work(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite, store: new EventStore(db) };
}
const event: WorkspaceEvent = {
  id: "one",
  actor_id: "laptop",
  clock: 1,
  created_at: "2026-11-07T00:00:00Z",
  payload: "{}",
};
it("copies legacy local events without clearing them or resetting upload acknowledgements", async () => {
  const { db, sqlite, store } = fixture();
  sqlite
    .prepare("INSERT INTO workspace_events VALUES (?, ?, ?, ?, ?)")
    .run(
      event.id,
      event.actor_id,
      event.clock,
      event.created_at,
      event.payload,
    );
  await initializeEventStore(db);
  expect(await store.pending()).toEqual([event]);
  await store.acknowledge([event]);
  await initializeEventStore(db);
  expect(await store.pending()).toEqual([]);
  expect(await db.getAll("SELECT * FROM workspace_events")).toHaveLength(1);
});
it("commits downloaded data with its cursor and creates no outbound upload", async () => {
  const { store } = fixture();
  await store.receive([event], { key: "direct_cursor", value: "5" });
  expect(await store.setting("direct_cursor")).toBe("5");
  expect(await store.pending()).toEqual([]);
  await store.receive([event], { key: "direct_cursor", value: "3" });
  expect(await store.setting("direct_cursor")).toBe("5");
});
it("rolls back a conflicting download including its cursor", async () => {
  const { db, store } = fixture();
  await store.receive([event]);
  await expect(
    store.receive(
      [
        { ...event, id: "two" },
        { ...event, payload: "different" },
      ],
      { key: "direct_cursor", value: "6" },
    ),
  ).rejects.toThrow("Conflicting");
  expect(await db.getAll("SELECT * FROM event_log")).toHaveLength(1);
  expect(await store.setting("direct_cursor")).toBeNull();
});
it("keeps account and deployment binding across reconnects", async () => {
  const { store } = fixture();
  await store.bind("convex:dev:owner");
  await store.bind("convex:dev:owner");
  await expect(store.bind("convex:prod:owner")).rejects.toThrow(
    "another account",
  );
  expect(await store.setting("account")).toBe("convex:dev:owner");
});
