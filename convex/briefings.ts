import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./access";
import { publish } from "./publish";
import { projectWorkspace, type Action } from "../src/domain/workspace";
import {
  briefingScheduleSchema,
  nextBriefingTime,
} from "../src/domain/briefing-schedule";
import { createBriefing } from "../src/domain/receipt-builder";
import { atTime, zonedDate } from "../src/domain/planning";
import { weatherSnapshotSchema, weatherKey } from "../src/domain/weather";

async function workspace(ctx: QueryCtx, owner: Id<"users">) {
  const rows = await ctx.db
    .query("workspace_events")
    .withIndex("by_owner", (q) => q.eq("owner_id", owner))
    .take(10001);
  if (rows.length > 10000)
    throw new Error(
      "Workspace history needs compaction before preparing a briefing.",
    );
  return projectWorkspace(rows.map((e) => ({ ...e, id: e.uuid })));
}
export async function receiveBriefingAction(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  if (
    action.type !== "briefing.schedule" &&
    action.type !== "planning.settings"
  )
    return;
  const row = await ctx.db
    .query("briefing_schedules")
    .withIndex("by_owner", (q) => q.eq("owner_id", owner))
    .unique();
  if (action.type === "planning.settings") {
    if (row)
      await ctx.db.patch(row._id, {
        nextRun: Date.now(),
        version: row.version + 1,
      });
    return;
  }
  const settings = (await workspace(ctx, owner)).briefingSchedule;
  if (
    settings.output === "printer" &&
    new URL(settings.appUrl).hostname.endsWith(".invalid")
  )
    throw new Error("Set a public app URL before enabling physical printing.");
  const fields = {
    settings: JSON.stringify(settings),
    nextRun: settings.enabled ? Date.now() : Number.MAX_SAFE_INTEGER,
    version: (row?.version ?? 0) + 1,
    error: undefined,
  };
  if (row) await ctx.db.patch(row._id, fields);
  else
    await ctx.db.insert("briefing_schedules", { ...fields, owner_id: owner });
}
export const status = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      lastDay: v.union(v.string(), v.null()),
      error: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const row = await ctx.db
      .query("briefing_schedules")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique();
    return row
      ? { lastDay: row.lastDay ?? null, error: row.error ?? null }
      : null;
  },
});
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("briefing_schedules")
      .withIndex("by_nextRun", (q) => q.lte("nextRun", now))
      .take(20);
    for (const row of rows) {
      const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
      if (!s.enabled) {
        await ctx.db.patch(row._id, { nextRun: Number.MAX_SAFE_INTEGER });
        continue;
      }
      // Five-minute recovery window if the external action crashes.
      await ctx.db.patch(row._id, { nextRun: now + 5 * 60000 });
      await ctx.scheduler.runAfter(0, internal.briefingWeather.prepare, {
        id: row._id,
        version: row.version,
      });
    }
    return null;
  },
});
export const context = internalQuery({
  args: {
    id: v.id("briefing_schedules"),
    version: v.number(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, { id, version, now }) => {
    const row = await ctx.db.get(id);
    if (!row || row.version !== version) return null;
    const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
    if (!s.enabled) return null;
    const state = await workspace(ctx, row.owner_id);
    const zone = state.planningSettings.timeZone,
      day = zonedDate(now, zone);
    const due = now >= atTime(day, s.time, zone) && row.lastDay !== day;
    return {
      day,
      zone,
      weather:
        due &&
        !state.issuedBriefings[day] &&
        state.briefingTemplate.sections.some((s) => s.kind === "weather")
          ? (state.briefingTemplate.weather ?? null)
          : null,
    };
  },
});
export const complete = internalMutation({
  args: {
    id: v.id("briefing_schedules"),
    version: v.number(),
    day: v.string(),
    weather: v.optional(v.string()),
    warning: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, version, day, weather, warning }) => {
    const row = await ctx.db.get(id);
    if (!row || row.version !== version) return null;
    const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
    if (!s.enabled) return null;
    const now = Date.now(),
      state = await workspace(ctx, row.owner_id),
      zone = state.planningSettings.timeZone;
    const today = zonedDate(now, zone);
    if (
      today !== day ||
      now < atTime(today, s.time, zone) ||
      row.lastDay === today
    ) {
      await ctx.db.patch(id, {
        nextRun: nextBriefingTime(now, s.time, zone, row.lastDay),
      });
      return null;
    }
    const existing = await ctx.db
      .query("briefing_runs")
      .withIndex("by_owner_day", (q) =>
        q.eq("owner_id", row.owner_id).eq("day", day),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(id, {
        lastDay: day,
        nextRun: nextBriefingTime(now, s.time, zone, day),
      });
      return null;
    }
    if (weather && state.briefingTemplate.weather) {
      const fresh = weatherSnapshotSchema.parse(JSON.parse(weather));
      if (
        fresh.key === weatherKey(state.briefingTemplate.weather, zone) &&
        fresh.date === day
      ) {
        state.weatherSnapshots[fresh.key] = fresh;
        await publish(ctx, row.owner_id, {
          type: "weather.snapshot",
          snapshot: fresh,
        });
      }
    }
    // Draft plans never become tasks until approval. Reuse a manually saved briefing if present.
    const snapshot =
      state.issuedBriefings[day] ??
      createBriefing(
        state,
        state.briefingTemplate,
        new URL(s.appUrl).hostname.endsWith(".invalid")
          ? process.env.SITE_URL || s.appUrl
          : s.appUrl,
        now,
      );
    const action = { type: "briefing.issue" as const, date: day, snapshot };
    if (JSON.stringify(action).length > 50000)
      throw new Error("Briefing is too long. Shorten the saved template.");
    if (!state.issuedBriefings[day]) await publish(ctx, row.owner_id, action);
    const job = crypto.randomUUID();
    await ctx.db.insert("print_jobs", {
      uuid: job,
      owner_id: row.owner_id,
      snapshot: JSON.stringify(snapshot),
      output: s.output,
      status: "queued",
      created_at: new Date(now).toISOString(),
      error: null,
    });
    await ctx.db.insert("briefing_runs", {
      owner_id: row.owner_id,
      day,
      job_id: job,
    });
    await ctx.db.patch(id, {
      lastDay: day,
      nextRun: nextBriefingTime(now, s.time, zone, day),
      error: warning,
    });
    return null;
  },
});
export const failed = internalMutation({
  args: {
    id: v.id("briefing_schedules"),
    version: v.number(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, version, message }) => {
    const row = await ctx.db.get(id);
    if (row?.version === version)
      await ctx.db.patch(id, {
        error: message.slice(0, 500),
        nextRun: Date.now() + 15 * 60000,
      });
    return null;
  },
});
