import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { projectWorkspace, taskDefaults } from "../src/domain/workspace";
import { defaultPlanningSettings } from "../src/domain/planning";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
async function setup() {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email: "owner@example.com" });
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  return { t, id, owner: t.withIdentity({ subject: `${id}|session` }) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("protects calendar sources, hides private links from event sync, and ignores late refreshes", async () => {
  vi.useFakeTimers();
  const { t, owner } = await setup();
  const id = await owner.mutation(api.calendars.add, {
    name: "Work",
    url: "https://calendar.google.com/calendar/ical/private-secret/basic.ics",
  });
  await expect(t.mutation(api.calendars.remove, { id })).rejects.toThrow(
    "access",
  );
  const otherId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  await expect(
    t
      .withIdentity({ subject: `${otherId}|session` })
      .mutation(api.calendars.refresh, { id }),
  ).rejects.toThrow("not found");
  let events = await t.run((ctx) => ctx.db.query("workspace_events").collect());
  expect(JSON.stringify(events)).not.toContain("private-secret");
  const snapshot = JSON.parse(events[0].payload).source;
  await owner.mutation(api.calendars.remove, { id });
  await t.mutation(internal.calendars.finish, {
    id,
    version: 1,
    snapshot: JSON.stringify(snapshot),
  });
  events = await t.run((ctx) => ctx.db.query("workspace_events").collect());
  expect(
    projectWorkspace(events.map((e) => ({ ...e, id: e.uuid }))).calendars,
  ).toHaveLength(0);
});
it("rejects forged calendar and planner results", async () => {
  vi.useFakeTimers();
  const { owner } = await setup();
  for (const payload of [
    { type: "calendar.remove", sourceId: "other" },
    {
      type: "planning.result",
      plan: {
        id: crypto.randomUUID(),
        date: "2026-11-09",
        basis: "",
        createdAt: 0,
        status: "ready",
        blocks: [],
        availableMinutes: 0,
        message: "fake",
      },
    },
  ]) {
    await expect(
      owner.mutation(api.workspace.appendEvents, {
        events: [
          {
            id: crypto.randomUUID(),
            actor_id: "test",
            clock: 1,
            created_at: new Date().toISOString(),
            payload: JSON.stringify(payload),
          },
        ],
      }),
    ).rejects.toThrow("server");
  }
});
it("queues evening planning once in the saved timezone and leaves task scheduling untouched", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T00:30:00Z"));
  const { t, owner } = await setup();
  const actions = [
    {
      type: "planning.settings",
      settings: {
        ...defaultPlanningSettings("America/New_York"),
        enabled: true,
      },
    },
    {
      type: "task.create",
      taskId: crypto.randomUUID(),
      fields: taskDefaults("Open portfolio"),
    },
  ];
  await owner.mutation(api.workspace.appendEvents, {
    events: actions.map((a, i) => ({
      id: crypto.randomUUID(),
      actor_id: "test",
      clock: i + 1,
      created_at: new Date().toISOString(),
      payload: JSON.stringify(a),
    })),
  });
  await t.mutation(internal.planning.tick, {});
  await t.mutation(internal.planning.tick, {});
  const jobs = await t.run((ctx) => ctx.db.query("planning_jobs").collect());
  expect(jobs).toHaveLength(1);
  expect(jobs[0].date).toBe("2026-11-09");
  const events = await t.run((ctx) =>
    ctx.db.query("workspace_events").collect(),
  );
  expect(
    projectWorkspace(events.map((e) => ({ ...e, id: e.uuid }))).tasks[0]
      .scheduledDate,
  ).toBeUndefined();
});

it("retains the last good calendar snapshot on fetch failure without disclosing its URL", async () => {
  vi.useFakeTimers();
  const { t, owner } = await setup();
  const id = await owner.mutation(api.calendars.add, {
    name: "Personal",
    url: "https://calendar.google.com/private-secret.ics",
  });
  const current = await t.run((ctx) => ctx.db.get(id));
  const source = {
    ...JSON.parse(current!.snapshot),
    events: [
      {
        id: "one",
        title: "Appointment",
        start: 100,
        end: 200,
        allDay: false,
        busy: true,
      },
    ],
    refreshedAt: 123,
    error: null,
  };
  await t.mutation(internal.calendars.finish, {
    id,
    version: 1,
    snapshot: JSON.stringify(source),
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new Error("https://calendar.google.com/private-secret.ics"),
      ),
  );
  await t.action(internal.calendarFetch.refresh, { id, version: 1 });
  const saved = await t.run((ctx) => ctx.db.get(id));
  const snapshot = JSON.parse(saved!.snapshot);
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.refreshedAt).toBe(123);
  expect(snapshot.error).not.toContain("private-secret");
});
