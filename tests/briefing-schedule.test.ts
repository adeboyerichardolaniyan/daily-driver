import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { nextBriefingTime } from "../src/domain/briefing-schedule";
import { projectWorkspace } from "../src/domain/workspace";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const now = Date.parse("2026-11-07T13:00:00Z");
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const t = convexTest(schema, modules);
  const user = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const owner = t.withIdentity({ subject: `${user}|session` });
  const settings = {
    enabled: true,
    time: "07:00",
    output: "pdf" as const,
    appUrl: "https://example.invalid",
  };
  let clock = 0;
  async function save(value = settings) {
    await owner.mutation(api.workspace.appendEvents, {
      events: [
        {
          id: crypto.randomUUID(),
          actor_id: "test",
          clock: ++clock,
          created_at: new Date(now).toISOString(),
          payload: JSON.stringify({
            type: "briefing.schedule",
            settings: value,
          }),
        },
      ],
    });
    await t.action(internal.briefings.syncSettings, { owner: user });
  }
  await save();
  const pref = await t.run((ctx) =>
    ctx.db.query("briefing_schedules").unique(),
  );
  return { t, owner, user, settings, save, pref: pref! };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("prepares one immutable daily briefing and PDF job even when invoked concurrently", async () => {
  const { t, pref } = await setup();
  const args = { id: pref._id, version: pref.version, day: "2026-11-07" };
  await Promise.all([
    t.action(internal.briefings.complete, args),
    t.action(internal.briefings.complete, args),
  ]);
  const jobs = await t.run((ctx) => ctx.db.query("print_jobs").collect());
  expect(jobs).toHaveLength(1);
  expect(jobs[0].output).toBe("pdf");
  const events = await t.run((ctx) =>
    ctx.db.query("workspace_events").collect(),
  );
  const state = projectWorkspace(events.map((e) => ({ ...e, id: e.uuid })));
  expect(state.issuedBriefings["2026-11-07"]).toBeDefined();
  expect(state.issuedBriefings["2026-11-07"].tasks).toEqual([]);
  expect(state.briefingSchedule.enabled).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(pref._id)))?.nextRun).toBe(
    Date.parse("2026-11-08T12:00:00Z"),
  );
});
it("respects disabled schedules, version changes and time before delivery", async () => {
  const { t, pref, save, settings } = await setup();
  await save({ ...settings, time: "23:00" });
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 2,
    day: "2026-11-07",
  });
  expect(
    await t.run((ctx) => ctx.db.query("print_jobs").collect()),
  ).toHaveLength(0);
  vi.setSystemTime(now);
  await save({ ...settings, enabled: false });
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 2,
    day: "2026-11-07",
  });
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 3,
    day: "2026-11-07",
  });
  expect(
    await t.run((ctx) => ctx.db.query("print_jobs").collect()),
  ).toHaveLength(0);
});
it("cron prepares a briefing while the client is closed", async () => {
  const { t, owner } = await setup();
  await t.mutation(internal.briefings.tick, {});
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await owner.query(api.briefings.status, {}))?.lastDay).toBe(
    "2026-11-07",
  );
  await expect(t.query(api.briefings.status, {})).rejects.toThrow("access");
});
it("PDF workers cannot claim physical jobs and report PDF output separately", async () => {
  const { t, pref, owner } = await setup();
  vi.stubEnv("PRINT_WORKER_SECRET", "x".repeat(32));
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 1,
    day: "2026-11-07",
  });
  const credentials = { secret: "x".repeat(32), worker: "test-worker" };
  expect(
    await t.mutation(api.printing.claim, { ...credentials, output: "printer" }),
  ).toBeNull();
  const job = await t.mutation(api.printing.claim, {
    ...credentials,
    output: "pdf",
  });
  expect(job).not.toBeNull();
  await t.mutation(api.printing.finish, {
    ...credentials,
    id: job!.id,
    outcome: "rendered",
    detail: "PDF saved",
  });
  expect((await owner.query(api.printing.list, {}))[0].status).toBe("rendered");
  expect(
    await t.mutation(api.printing.claim, { ...credentials, output: "pdf" }),
  ).toBeNull();
  await expect(
    t.mutation(api.printing.claim, {
      ...credentials,
      secret: "bad",
      output: "pdf",
    }),
  ).rejects.toThrow("authentication");
});
it("handles DST and does not backfill yesterday's briefing", () => {
  expect(
    nextBriefingTime(
      Date.parse("2026-11-01T05:30:00Z"),
      "07:00",
      "America/New_York",
    ),
  ).toBe(Date.parse("2026-11-01T12:00:00Z"));
  expect(nextBriefingTime(now, "07:00", "America/New_York", "2026-11-06")).toBe(
    now,
  );
});
it("reuses a saved briefing instead of regenerating its content", async () => {
  const { t, pref, owner } = await setup();
  const snapshot = {
    version: 1,
    title: "Already approved",
    date: "November 7",
    day: "2026-11-07",
    tasks: [],
  };
  await owner.mutation(api.workspace.appendEvents, {
    events: [
      {
        id: crypto.randomUUID(),
        actor_id: "test",
        clock: 2,
        created_at: new Date(now).toISOString(),
        payload: JSON.stringify({
          type: "briefing.issue",
          date: "2026-11-07",
          snapshot,
        }),
      },
    ],
  });
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 1,
    day: "2026-11-07",
  });
  const job = await t.run((ctx) => ctx.db.query("print_jobs").unique());
  expect(JSON.parse(job!.snapshot)).toEqual(snapshot);
});
it("refreshes weather in the background and saves a readable warning on provider failure", async () => {
  const { t, pref, owner } = await setup();
  const template = {
    title: "Morning",
    footer: "",
    showQr: true,
    showDoneWhen: false,
    weather: {
      name: "New York",
      latitude: 40.7,
      longitude: -74,
      unit: "fahrenheit",
    },
    sections: [{ id: "weather", kind: "weather", title: "Weather", text: "" }],
  };
  await owner.mutation(api.workspace.appendEvents, {
    events: [
      {
        id: crypto.randomUUID(),
        actor_id: "test",
        clock: 2,
        created_at: new Date(now).toISOString(),
        payload: JSON.stringify({ type: "briefing.template", template }),
      },
    ],
  });
  const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchMock);
  await t.action(internal.briefingWeather.prepare, {
    id: pref._id,
    version: 1,
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect((await owner.query(api.briefings.status, {}))?.error).toContain(
    "Weather refresh failed",
  );
  expect(
    await t.run((ctx) => ctx.db.query("print_jobs").collect()),
  ).toHaveLength(1);
});
it("keeps the converged schedule when another device uploads older edits later", async () => {
  const { t, owner, user, settings } = await setup();
  for (const [clock, enabled] of [
    [20, true],
    [10, false],
  ] as const) {
    await owner.mutation(api.workspace.appendEvents, {
      events: [
        {
          id: crypto.randomUUID(),
          actor_id: "other-device",
          clock,
          created_at: new Date(now).toISOString(),
          payload: JSON.stringify({
            type: "briefing.schedule",
            settings: { ...settings, enabled },
          }),
        },
      ],
    });
  }
  await t.action(internal.briefings.syncSettings, { owner: user });
  const row = await t.run((ctx) => ctx.db.query("briefing_schedules").unique());
  expect(JSON.parse(row!.settings).enabled).toBe(true);
});
it("administrative recovery retries a failed PDF once and refuses physical output", async () => {
  const { t, pref } = await setup();
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 1,
    day: "2026-11-07",
  });
  const job = await t.run((ctx) => ctx.db.query("print_jobs").unique());
  await t.run((ctx) => ctx.db.patch(job!._id, { status: "failed" }));
  const first = await t.mutation(internal.printing.retryFailedPdf, {
    id: job!.uuid,
  });
  expect(
    await t.mutation(internal.printing.retryFailedPdf, { id: job!.uuid }),
  ).toBe(first);
  expect(
    await t.run((ctx) => ctx.db.query("print_jobs").collect()),
  ).toHaveLength(2);
  await t.run((ctx) => ctx.db.patch(job!._id, { output: "printer" }));
  await expect(
    t.mutation(internal.printing.retryFailedPdf, { id: job!.uuid }),
  ).rejects.toThrow("Only failed PDF");
});
it("uses the deployed app URL for schedules originally saved in PDF placeholder mode", async () => {
  const { t, pref } = await setup();
  vi.stubEnv("SITE_URL", "https://daily-driver-liard.vercel.app");
  await t.action(internal.briefings.complete, {
    id: pref._id,
    version: 1,
    day: "2026-11-07",
  });
  const job = await t.run((ctx) => ctx.db.query("print_jobs").unique());
  expect(JSON.parse(job!.snapshot).briefingUrl).toBe(
    "https://daily-driver-liard.vercel.app/?briefing=2026-11-07",
  );
});
