import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { taskDefaults } from "../src/domain/workspace";
import { createReceipt } from "../src/domain/receipt";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const event = {
  id: "00000000-0000-4000-8000-000000000012",
  actor_id: "laptop",
  clock: 1,
  created_at: "2026-11-07T00:00:00Z",
  payload: JSON.stringify({
    type: "task.create",
    taskId: "00000000-0000-4000-8000-000000000011",
    fields: taskDefaults("Update portfolio"),
  }),
};
const snapshot = JSON.stringify(
  createReceipt(
    [{ id: event.id, ...taskDefaults("Portfolio") }],
    "https://daily.example",
  ),
);
const jobId = "00000000-0000-4000-8000-000000000013";
const worker = {
  secret: "test-only-worker-credential-32-characters",
  worker: "mini",
};
async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email: "owner@example.com" });
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const outsiderId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "other@example.com" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const outsider = t.withIdentity({ subject: `${outsiderId}|session` });
  vi.stubEnv("PRINT_WORKER_SECRET", worker.secret);
  return { t, owner, outsider, ownerId };
}
afterEach(() => vi.unstubAllEnvs());
describe("Convex event ownership and durable retries", () => {
  it("accepts an identical retry only once and binds ownership on the server", async () => {
    const { t, owner, ownerId } = await setup();
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    const rows = await t.run((ctx) =>
      ctx.db.query("workspace_events").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_id).toBe(ownerId);
    expect(rows[0].uuid).toBe(event.id);
  });
  it("rejects anonymous and non-member writes and reads", async () => {
    const { t, outsider } = await setup();
    for (const client of [t, outsider]) {
      await expect(
        client.mutation(api.workspace.appendEvents, { events: [event] }),
      ).rejects.toThrow("access");
      await expect(client.query(api.workspace.account, {})).rejects.toThrow(
        "access",
      );
      await expect(client.query(api.printing.list, {})).rejects.toThrow(
        "access",
      );
      await expect(
        client.mutation(api.printing.enqueue, { id: jobId, snapshot }),
      ).rejects.toThrow("access");
    }
  });
  it("rejects collisions atomically without overwriting existing history", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    await expect(
      owner.mutation(api.workspace.appendEvents, {
        events: [
          { ...event, id: jobId },
          { ...event, clock: 2 },
        ],
      }),
    ).rejects.toThrow("collision");
    expect(
      await t.run((ctx) => ctx.db.query("workspace_events").collect()),
    ).toHaveLength(1);
  });
  it("validates the action payload and event clock", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.workspace.appendEvents, {
        events: [{ ...event, payload: '{"type":"invalid"}' }],
      }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.workspace.appendEvents, {
        events: [{ ...event, clock: 0.5 }],
      }),
    ).rejects.toThrow("metadata");
  });
});
describe("Convex print queue", () => {
  it("deduplicates submission, rejects changed snapshots, and claims once", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.printing.enqueue, { id: jobId, snapshot });
    await owner.mutation(api.printing.enqueue, { id: jobId, snapshot });
    await expect(
      owner.mutation(api.printing.enqueue, {
        id: jobId,
        snapshot: snapshot.replace("Daily briefing", "Other briefing") + " ",
      }),
    ).rejects.toThrow("collision");
    const claims = await Promise.all([
      t.mutation(api.printing.claim, worker),
      t.mutation(api.printing.claim, { ...worker, worker: "other-mini" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await owner.query(api.printing.list, {}))[0].status).toBe(
      "processing",
    );
  });
  it("requires a dedicated worker secret and the assigned worker ID", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.printing.enqueue, { id: jobId, snapshot });
    await expect(
      t.mutation(api.printing.claim, { ...worker, secret: "wrong" }),
    ).rejects.toThrow("authentication");
    await t.mutation(api.printing.claim, worker);
    await expect(
      t.mutation(api.printing.finish, {
        ...worker,
        worker: "wrong",
        id: jobId,
        outcome: "dispatched",
        detail: null,
      }),
    ).rejects.toThrow("assigned");
  });
  it("keeps interrupted jobs uncertain and does not automatically claim them again", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.printing.enqueue, { id: jobId, snapshot });
    await t.mutation(api.printing.claim, worker);
    expect(await t.query(api.printing.interrupted, worker)).toEqual([
      { id: jobId },
    ]);
    const finish = {
      ...worker,
      id: jobId,
      outcome: "uncertain" as const,
      detail: "Check printer",
    };
    await t.mutation(api.printing.finish, finish);
    await t.mutation(api.printing.finish, finish);
    await expect(
      t.mutation(api.printing.finish, { ...finish, outcome: "dispatched" }),
    ).rejects.toThrow("terminal");
    expect(await t.mutation(api.printing.claim, worker)).toBeNull();
  });
  it("rejects malformed receipts before queueing", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.printing.enqueue, { id: jobId, snapshot: "{}" }),
    ).rejects.toThrow();
    expect(await owner.query(api.printing.list, {})).toEqual([]);
  });
});

describe("private authentication", () => {
  it("disables public registration even when the caller knows the owner email", async () => {
    const { t } = await setup();
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: {
          flow: "signUp",
          email: "owner@example.com",
          password: "not-a-real-password",
        },
      }),
    ).rejects.toThrow("Public registration is disabled");
  });
});
