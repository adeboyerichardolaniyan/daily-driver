import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import schema from "./schema";
import { requireOwner } from "./access";
import { publish } from "./publish";
import type { Action, Workspace } from "../src/domain/workspace";
import {
  briefingScheduleSchema,
  nextBriefingTime,
} from "../src/domain/briefing-schedule";
import { createBriefing, receiptSchema } from "../src/domain/receipt-builder";
import { atTime, zonedDate } from "../src/domain/planning";
import { weatherSnapshotSchema, weatherKey } from "../src/domain/weather";
import { workspaceSequence } from "./workspaceHistory";

export function validateBriefingAction(action: Action) {
  if (
    action.type === "briefing.schedule" &&
    action.settings.output === "printer" &&
    new URL(action.settings.appUrl).hostname.endsWith(".invalid")
  )
    throw new Error("Set a public app URL before enabling physical printing.");
}

// Reconcile once per upload batch after its head is committed. Replaying all
// history inside appendEvents would make saving a schedule hit the read limit.
export async function receiveBriefingAction(
  ctx: MutationCtx,
  owner: Id<"users">,
) {
  await ctx.scheduler.runAfter(0, internal.briefings.syncSettings, { owner });
}

export const syncSettings = internalAction({
  args: { owner: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { owner }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await ctx.runAction(internal.workspaceReader.read, {
        owner,
      });
      const state: Workspace = JSON.parse(read.state);
      const saved: boolean = await ctx.runMutation(
        internal.briefings.saveSettings,
        {
          owner,
          sequence: read.sequence,
          settings: JSON.stringify(state.briefingSchedule),
          planning: JSON.stringify(state.planningSettings),
          timeZone: state.planningSettings.timeZone,
        },
      );
      if (saved) return null;
    }
    await ctx.scheduler.runAfter(1000, internal.briefings.syncSettings, {
      owner,
    });
    return null;
  },
});

export const saveSettings = internalMutation({
  args: {
    owner: v.id("users"),
    sequence: v.number(),
    settings: v.string(),
    planning: v.string(),
    timeZone: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { owner, sequence, settings, planning, timeZone }) => {
    if ((await workspaceSequence(ctx, owner)) !== sequence) return false;
    const row = await ctx.db
      .query("briefing_schedules")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique();
    const pref = await ctx.db
      .query("planning_preferences")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique();
    if (pref && pref.settings !== planning)
      await ctx.db.patch(pref._id, { settings: planning });
    if (row?.settings === settings && row.timeZone === timeZone) return true;
    const s = briefingScheduleSchema.parse(JSON.parse(settings));
    const fields = {
      settings,
      timeZone,
      version: (row?.version ?? 0) + 1,
      error: undefined,
      nextRun: s.enabled ? Date.now() : Number.MAX_SAFE_INTEGER,
    };
    if (row) await ctx.db.patch(row._id, fields);
    else
      await ctx.db.insert("briefing_schedules", { ...fields, owner_id: owner });
    return true;
  },
});

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
      await ctx.db.patch(row._id, { nextRun: now + 5 * 60000 });
      await ctx.scheduler.runAfter(0, internal.briefingWeather.prepare, {
        id: row._id,
        version: row.version,
      });
    }
    return null;
  },
});
const scheduleArgs = { id: v.id("briefing_schedules"), version: v.number() };
export const load = internalQuery({
  args: scheduleArgs,
  returns: v.union(v.null(), schema.doc("briefing_schedules")),
  handler: async (ctx, { id, version }) => {
    const row = await ctx.db.get(id);
    return row?.version === version && JSON.parse(row.settings).enabled
      ? row
      : null;
  },
});
const prepared = v.object({ sequence: v.number(), state: v.string() });
export const context = internalAction({
  args: { ...scheduleArgs, now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      day: v.string(),
      zone: v.string(),
      weather: v.union(v.string(), v.null()),
      prepared,
    }),
  ),
  handler: async (
    ctx,
    { id, version, now },
  ): Promise<{
    day: string;
    zone: string;
    weather: string | null;
    prepared: { sequence: number; state: string };
  } | null> => {
    const row: Doc<"briefing_schedules"> | null = await ctx.runQuery(
      internal.briefings.load,
      { id, version },
    );
    if (!row) return null;
    const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
    const read = await ctx.runAction(internal.workspaceReader.read, {
      owner: row.owner_id,
    });
    const state: Workspace = JSON.parse(read.state);
    if (row.settings !== JSON.stringify(state.briefingSchedule)) {
      await ctx.runAction(internal.briefings.syncSettings, {
        owner: row.owner_id,
      });
      return null;
    }
    const zone = state.planningSettings.timeZone,
      day = zonedDate(now, zone);
    const due = now >= atTime(day, s.time, zone) && row.lastDay !== day;
    return {
      day,
      zone,
      prepared: read,
      weather:
        due &&
        !state.issuedBriefings[day] &&
        state.briefingTemplate.sections.some((s) => s.kind === "weather") &&
        state.briefingTemplate.weather
          ? JSON.stringify(state.briefingTemplate.weather)
          : null,
    };
  },
});
export const complete = internalAction({
  args: {
    ...scheduleArgs,
    day: v.string(),
    weather: v.optional(v.string()),
    warning: v.optional(v.string()),
    prepared: v.optional(prepared),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let read = args.prepared;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row: Doc<"briefing_schedules"> | null = await ctx.runQuery(
        internal.briefings.load,
        { id: args.id, version: args.version },
      );
      if (!row) return null;
      read ??= await ctx.runAction(internal.workspaceReader.read, {
        owner: row.owner_id,
      });
      const state: Workspace = JSON.parse(read.state);
      if (row.settings !== JSON.stringify(state.briefingSchedule)) {
        await ctx.runAction(internal.briefings.syncSettings, {
          owner: row.owner_id,
        });
        return null;
      }
      const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
      const now = Date.now(),
        zone = state.planningSettings.timeZone;
      const due =
        zonedDate(now, zone) === args.day &&
        now >= atTime(args.day, s.time, zone) &&
        row.lastDay !== args.day;
      let weather: string | undefined;
      if (args.weather && state.briefingTemplate.weather) {
        const fresh = weatherSnapshotSchema.parse(JSON.parse(args.weather));
        if (
          fresh.key === weatherKey(state.briefingTemplate.weather, zone) &&
          fresh.date === args.day
        ) {
          state.weatherSnapshots[fresh.key] = fresh;
          weather = JSON.stringify(fresh);
        }
      }
      const snapshot = due
        ? JSON.stringify(
            state.issuedBriefings[args.day] ??
              createBriefing(
                state,
                state.briefingTemplate,
                new URL(s.appUrl).hostname.endsWith(".invalid")
                  ? process.env.SITE_URL || s.appUrl
                  : s.appUrl,
                now,
              ),
          )
        : undefined;
      const saved: boolean = await ctx.runMutation(internal.briefings.commit, {
        id: args.id,
        version: args.version,
        day: args.day,
        zone,
        sequence: read.sequence,
        snapshot,
        issue: !state.issuedBriefings[args.day],
        weather,
        warning: args.warning,
      });
      if (saved) return null;
      read = undefined;
    }
    await ctx.scheduler.runAfter(1000, internal.briefingWeather.prepare, {
      id: args.id,
      version: args.version,
    });
    return null;
  },
});
export const commit = internalMutation({
  args: {
    ...scheduleArgs,
    day: v.string(),
    zone: v.string(),
    sequence: v.number(),
    snapshot: v.optional(v.string()),
    issue: v.boolean(),
    weather: v.optional(v.string()),
    warning: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (
    ctx,
    {
      id,
      version,
      day,
      zone,
      sequence,
      snapshot: raw,
      issue,
      weather,
      warning,
    },
  ) => {
    const row = await ctx.db.get(id);
    if (!row || row.version !== version) return true;
    const s = briefingScheduleSchema.parse(JSON.parse(row.settings));
    if (!s.enabled) return true;
    if ((await workspaceSequence(ctx, row.owner_id)) !== sequence) return false;
    const now = Date.now(),
      today = zonedDate(now, zone);
    if (
      today !== day ||
      now < atTime(today, s.time, zone) ||
      row.lastDay === today
    ) {
      await ctx.db.patch(id, {
        nextRun: nextBriefingTime(now, s.time, zone, row.lastDay),
      });
      return true;
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
        error: undefined,
      });
      return true;
    }
    if (!raw) throw new Error("Briefing snapshot is missing.");
    const snapshot = receiptSchema.parse(JSON.parse(raw));
    const action = { type: "briefing.issue" as const, date: day, snapshot };
    if (new TextEncoder().encode(JSON.stringify(action)).length > 50000)
      throw new Error("Briefing is too long. Shorten the saved template.");
    if (weather)
      await publish(ctx, row.owner_id, {
        type: "weather.snapshot",
        snapshot: weatherSnapshotSchema.parse(JSON.parse(weather)),
      });
    if (issue) await publish(ctx, row.owner_id, action);
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
    return true;
  },
});
export const failed = internalMutation({
  args: { ...scheduleArgs, message: v.string() },
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
