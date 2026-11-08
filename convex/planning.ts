import { v } from "convex/values";
import {
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  elapsed,
  projectWorkspace,
  type Action,
} from "../src/domain/workspace";
import {
  dailyPlanSchema,
  planningBasis,
  zonedDate,
  nextDate,
  atTime,
  candidates,
} from "../src/domain/planning";
import { publish } from "./publish";

async function workspace(ctx: QueryCtx, owner: Id<"users">) {
  const events = await ctx.db
    .query("workspace_events")
    .withIndex("by_owner", (q) => q.eq("owner_id", owner))
    .take(10001);
  if (events.length > 10000)
    throw new Error(
      "Planning history needs compaction before generating another plan.",
    );
  return projectWorkspace(events.map((e) => ({ ...e, id: e.uuid })));
}
async function enqueue(
  ctx: MutationCtx,
  owner: Id<"users">,
  planId: string,
  date: string,
  basis: string,
) {
  const existing = await ctx.db
    .query("planning_jobs")
    .withIndex("by_plan", (q) => q.eq("plan_id", planId))
    .unique();
  if (existing) {
    if (existing.owner_id !== owner)
      throw new Error("Plan belongs to another workspace.");
    return;
  }
  const id = await ctx.db.insert("planning_jobs", {
    owner_id: owner,
    plan_id: planId,
    date,
    status: "queued",
    basis,
    attempt: 0,
  });
  await ctx.scheduler.runAfter(0, internal.planningAI.generate, { id });
}
export async function receivePlanningAction(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  if (action.type === "planning.settings") {
    const existing = await ctx.db
      .query("planning_preferences")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique();
    const fields = {
      owner_id: owner,
      settings: JSON.stringify(action.settings),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("planning_preferences", fields);
  }
  if (action.type === "planning.request")
    await enqueue(ctx, owner, action.planId, action.date, "");
}
export const claim = internalMutation({
  args: { id: v.id("planning_jobs") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (!job || !["queued", "waiting"].includes(job.status)) return null;
    const state = await workspace(ctx, job.owner_id);
    const plan = state.dailyPlans.find((p) => p.id === job.plan_id);
    if (plan && ["approved", "dismissed"].includes(plan.status)) {
      await ctx.db.patch(id, { status: "finished", basis: planningBasis(state.tasks,state.calendars,state.planningSettings,job.date) });
      return null;
    }
    const attempt = job.attempt + 1;
    await ctx.db.patch(id, { status: "running", attempt });
    await ctx.scheduler.runAfter(120000, internal.planning.expire, {
      id,
      attempt,
    });
    return { job: { ...job, attempt }, state };
  },
});
export const finish = internalMutation({
  args: { id: v.id("planning_jobs"), attempt: v.number(), plan: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, attempt, plan: raw }) => {
    const job = await ctx.db.get(id);
    if (!job || job.attempt !== attempt || job.status !== "running")
      return null;
    const plan = dailyPlanSchema.parse(JSON.parse(raw));
    if (plan.id !== job.plan_id || plan.date !== job.date)
      throw new Error("Invalid plan result");
    const state = await workspace(ctx, job.owner_id);
    if (
      plan.status === "ready" &&
      plan.basis !==
        planningBasis(
          state.tasks,
          state.calendars,
          state.planningSettings,
          plan.date,
        )
    ) {
      plan.status = "failed";
      plan.blocks = [];
      plan.message =
        "Your tasks or calendar changed while this was drafting. Prepare a fresh plan.";
    }
    await ctx.db.patch(id, {
      status: plan.status === "waiting" ? "waiting" : "finished",
      basis: plan.basis,
    });
    await publish(ctx, job.owner_id, { type: "planning.result", plan });
    return null;
  },
});
export const expire = internalMutation({
  args: { id: v.id("planning_jobs"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, attempt }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "running" || job.attempt !== attempt)
      return null;
    await ctx.db.patch(id, { status: "finished" });
    await publish(ctx, job.owner_id, {
      type: "planning.result",
      plan: {
        id: job.plan_id,
        date: job.date,
        basis: job.basis,
        createdAt: Date.now(),
        status: "failed",
        blocks: [],
        availableMinutes: 0,
        message: "Planning timed out. Try preparing the day again.",
      },
    });
    return null;
  },
});
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const prefs = await ctx.db
      .query("planning_preferences")
      .withIndex("by_owner")
      .take(20);
    for (const pref of prefs) {

      const state = await workspace(ctx, pref.owner_id);
      const s = state.planningSettings;
      if (!s.enabled) continue;
      const today = zonedDate(now, s.timeZone);
      const dates = [];
      if (now < atTime(today, s.workEnd, s.timeZone)) dates.push(today);
      if (now >= atTime(today, s.eveningTime, s.timeZone))
        dates.push(nextDate(today));
      for (const date of dates) {
        if (!candidates(state.tasks, date, today).length) continue;
        const basis = planningBasis(state.tasks, state.calendars, s, date);
        const jobs = await ctx.db
          .query("planning_jobs")
          .withIndex("by_owner_date", (q) =>
            q.eq("owner_id", pref.owner_id).eq("date", date),
          )
          .order("desc")
          .take(1);
        if (
          jobs.some((j) => ["queued", "running", "waiting"].includes(j.status))
        )
          continue;
        const latest = state.dailyPlans
          .filter((p) => p.date === date)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        const active =
          state.focus && !state.focus.stopped && state.focus.startedAt !== null
            ? state.tasks.find((t) => t.id === state.focus!.taskId)
            : undefined;
        const overrun =
          date === today &&
          active &&
          elapsed(state.focus, now) > active.minutes * 60000 &&
          latest &&
          latest.createdAt < now - 30 * 60000;
        if (latest && (latest.basis === basis || (latest.status === "dismissed" && jobs[0]?.basis === basis)) && !overrun) continue;
        const planId = crypto.randomUUID();
        await publish(ctx, pref.owner_id, {
          type: "planning.request",
          planId,
          date,
        });
        await enqueue(ctx, pref.owner_id, planId, date, basis);
      }
    }
    if (process.env.OPENAI_API_KEY) {
      const waiting = await ctx.db
        .query("planning_jobs")
        .withIndex("by_status", (q) => q.eq("status", "waiting"))
        .take(10);
      for (const job of waiting)
        await ctx.scheduler.runAfter(0, internal.planningAI.generate, {
          id: job._id,
        });
    }
    return null;
  },
});
