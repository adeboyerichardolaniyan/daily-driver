// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { taskDefaults, type Workspace } from "../src/domain/workspace";
import { defaultPlanningSettings, planningBasis } from "../src/domain/planning";

const modules = import.meta.glob("./**/*.{ts,js}");
const now = Date.parse("2026-11-12T15:00:00Z");
afterEach(() => vi.useRealTimers());

it("pins history to a revision while retaining legacy unsequenced events", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const owner = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {});
    for (const [name, sequence] of [
      ["legacy", undefined],
      ["captured", 1],
      ["later", 2],
    ] as const)
      await ctx.db.insert("workspace_events", {
        owner_id: owner,
        uuid: name,
        actor_id: "server",
        clock: sequence ?? 0,
        created_at: new Date(now).toISOString(),
        payload: "{}",
        sequence,
      });
    await ctx.db.insert("workspace_heads", { owner_id: owner, sequence: 2 });
    return owner;
  });
  const page = await t.query(internal.workspaceHistory.page, {
    owner,
    sequence: 1,
    paginationOpts: { cursor: null, numItems: 100, maximumBytesRead: 500_000 },
  });
  expect(page.page.map((event) => event.id)).toEqual(["legacy", "captured"]);
});

it("replays more than 16 MB in bounded transactions and prepares a complete briefing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const t = convexTest({ schema, modules, transactionLimits: true });
  const owner = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const source = {
    id: "large-calendar",
    name: "Calendar",
    refreshedAt: now,
    error: null,
    rangeStart: now - 86400000,
    rangeEnd: now + 86400000,
    events: Array.from({ length: 100 }, (_, i) => ({
      id: `event-${i}`,
      title: "x".repeat(250),
      start: now - 86400000,
      end: now - 86300000,
      allDay: false,
      busy: true,
    })),
  };
  const payload = JSON.stringify({ type: "calendar.snapshot", source });
  expect(payload.length * 550).toBeGreaterThan(16 * 1024 * 1024);
  for (let offset = 0; offset < 550; offset += 25) {
    await t.run(async (ctx) => {
      for (let i = offset; i < offset + 25; i++)
        await ctx.db.insert("workspace_events", {
          uuid: crypto.randomUUID(),
          owner_id: owner,
          actor_id: "calendar",
          clock: i + 1,
          sequence: i + 1,
          created_at: new Date(now).toISOString(),
          payload,
        });
    });
  }
  await t.run((ctx) =>
    ctx.db.insert("workspace_heads", { owner_id: owner, sequence: 550 }),
  );
  // This is the former indexed query: its row limit cannot protect the byte budget.
  await expect(
    t.query((ctx) =>
      ctx.db
        .query("workspace_events")
        .withIndex("by_owner", (q) => q.eq("owner_id", owner))
        .take(10001),
    ),
  ).rejects.toThrow(/16777216 bytes/);
  const signedIn = t.withIdentity({ subject: `${owner}|session` });
  const early = crypto.randomUUID(),
    late = crypto.randomUUID();
  const actions = [
    {
      type: "task.create",
      taskId: early,
      fields: taskDefaults("Early task", { position: 0 }),
    },
    {
      type: "planning.settings",
      settings: {
        ...defaultPlanningSettings("America/New_York"),
        enabled: true,
      },
    },
    {
      type: "briefing.schedule",
      settings: {
        enabled: true,
        time: "07:00",
        output: "pdf",
        appUrl: "https://example.invalid",
      },
    },
    {
      type: "task.create",
      taskId: late,
      fields: taskDefaults("Last task", { position: 1 }),
    },
  ];
  await signedIn.mutation(api.workspace.appendEvents, {
    events: actions.map((action, i) => ({
      id: crypto.randomUUID(),
      actor_id: "device",
      clock: i === 0 ? 1 : 551 + i,
      created_at: new Date(now).toISOString(),
      payload: JSON.stringify(action),
    })),
  });
  await t.action(internal.briefings.syncSettings, { owner });
  const read = await t.action(internal.workspaceReader.read, { owner });
  const state: Workspace = JSON.parse(read.state);
  expect(read.state.length).toBeLessThan(100_000);
  expect(state.events).toEqual([]);
  expect(state.tasks.map((t) => t.title)).toEqual(["Early task", "Last task"]);
  expect(state.calendars[0].events).toHaveLength(100);
  const schedule = await t.query((ctx) =>
    ctx.db
      .query("briefing_schedules")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique(),
  );
  await t.action(internal.briefingWeather.prepare, {
    id: schedule!._id,
    version: schedule!.version,
  });
  const job = await t.query((ctx) =>
    ctx.db
      .query("print_jobs")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique(),
  );
  expect(
    JSON.parse(job!.snapshot).tasks.map((t: { title: string }) => t.title),
  ).toEqual(["Early task", "Last task"]);
  expect(await signedIn.query(api.briefings.status, {})).toEqual({
    lastDay: "2026-11-12",
    error: null,
  });
  await t.action(internal.planning.tick, {});
  const planningJob = await t.query((ctx) =>
    ctx.db
      .query("planning_jobs")
      .withIndex("by_owner_date", (q) =>
        q.eq("owner_id", owner).eq("date", "2026-11-12"),
      )
      .unique(),
  );
  expect(planningJob).not.toBeNull();
  const claimed = await t.action(internal.planning.claim, {
    id: planningJob!._id,
  });
  expect(JSON.parse(claimed!.state).tasks).toHaveLength(2);
  await t.action(internal.planning.finish, {
    id: planningJob!._id,
    attempt: claimed!.job.attempt,
    plan: JSON.stringify({
      id: planningJob!.plan_id,
      date: planningJob!.date,
      createdAt: now,
      status: "ready",
      blocks: [],
      availableMinutes: 0,
      message: "Ready for review",
      basis: planningBasis(
        state.tasks,
        state.calendars,
        state.planningSettings,
        planningJob!.date,
      ),
    }),
  });
  expect((await t.query((ctx) => ctx.db.get(planningJob!._id)))!.status).toBe(
    "finished",
  );
}, 30000);

it("rejects a stale prepared snapshot and replays newer edits before committing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const t = convexTest({ schema, modules, transactionLimits: true });
  const owner = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const signedIn = t.withIdentity({ subject: `${owner}|session` });
  const append = (clock: number, action: unknown) =>
    signedIn.mutation(api.workspace.appendEvents, {
      events: [
        {
          id: crypto.randomUUID(),
          actor_id: "device",
          clock,
          created_at: new Date(now).toISOString(),
          payload: JSON.stringify(action),
        },
      ],
    });
  await append(1, {
    type: "briefing.schedule",
    settings: {
      enabled: true,
      time: "07:00",
      output: "pdf",
      appUrl: "https://example.invalid",
    },
  });
  await t.action(internal.briefings.syncSettings, { owner });
  const schedule = await t.query((ctx) =>
    ctx.db
      .query("briefing_schedules")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique(),
  );
  const read = await t.action(internal.workspaceReader.read, { owner });
  await append(2, {
    type: "task.create",
    taskId: crypto.randomUUID(),
    fields: taskDefaults("Arrived after the read"),
  });
  const args = {
    id: schedule!._id,
    version: schedule!.version,
    day: "2026-11-12",
    prepared: read,
  };
  await Promise.all([
    t.action(internal.briefings.complete, args),
    t.action(internal.briefings.complete, args),
  ]);
  const jobs = await t.query((ctx) =>
    ctx.db
      .query("print_jobs")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .take(2),
  );
  expect(jobs).toHaveLength(1);
  expect(JSON.parse(jobs[0].snapshot).tasks[0].title).toBe(
    "Arrived after the read",
  );
});

it("pages large sync events by bytes and does not skip the next sequence", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const owner = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    for (let i = 1; i <= 25; i++)
      await ctx.db.insert("workspace_events", {
        uuid: crypto.randomUUID(),
        owner_id: id,
        actor_id: "server",
        clock: i,
        sequence: i,
        created_at: new Date(now).toISOString(),
        payload: "x".repeat(300_000),
      });
    return id;
  });
  const signedIn = t.withIdentity({ subject: `${owner}|session` });
  const sequences: number[] = [];
  while (sequences.length < 25) {
    const rows = await signedIn.query(api.workspace.changes, {
      after: sequences.at(-1) ?? 0,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
    sequences.push(...rows.map((e) => e.sequence));
  }
  expect(sequences).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
});

it("recovers interrupted jobs in bounded owner-specific batches", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  vi.stubEnv("PRINT_WORKER_SECRET", "x".repeat(32));
  try {
    const owner = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {});
      await ctx.db.insert("app_members", { user_id: id });
      const other = await ctx.db.insert("users", {});
      await ctx.db.insert("print_jobs", {
        uuid: "other-owner",
        owner_id: other,
        worker_id: "worker",
        status: "processing",
        snapshot: "x".repeat(400_000),
        created_at: "2026-11-12",
        error: null,
      });
      return id;
    });
    for (let offset = 0; offset < 30; offset += 10)
      await t.run(async (ctx) => {
        for (let i = offset; i < offset + 10; i++)
          await ctx.db.insert("print_jobs", {
            uuid: `job-${i}`,
            owner_id: owner,
            worker_id: "worker",
            status: "processing",
            snapshot: "x".repeat(400_000),
            created_at: "2026-11-12",
            error: null,
          });
      });
    const credentials = { secret: "x".repeat(32), worker: "worker" };
    let recovered = 0;
    while (true) {
      const jobs = await t.query(api.printing.interrupted, credentials);
      if (!jobs.length) break;
      expect(jobs.length).toBeLessThanOrEqual(10);
      expect(jobs.some((job) => job.id === "other-owner")).toBe(false);
      for (const job of jobs)
        await t.mutation(api.printing.finish, {
          ...credentials,
          id: job.id,
          outcome: "uncertain",
          detail: "Interrupted",
        });
      recovered += jobs.length;
    }
    expect(recovered).toBe(30);
    expect(await t.mutation(api.printing.claim, credentials)).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
