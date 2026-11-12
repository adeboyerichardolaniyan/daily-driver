import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { elapsed, type Workspace, type Action } from "../src/domain/workspace";
import {
  dailyPlanSchema,
  planningBasis,
  zonedDate,
  nextDate,
  atTime,
  candidates,
} from "../src/domain/planning";
import { publish } from "./publish";
import { workspaceSequence } from "./workspaceHistory";
import schema from "./schema";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";

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
export const loadJob = internalQuery({
  args: { id: v.id("planning_jobs") },
  returns: v.union(v.null(), schema.doc("planning_jobs")),
  handler: async (ctx, { id }) => ctx.db.get(id),
});
export const claim = internalAction({
  args: { id: v.id("planning_jobs") },
  returns: v.union(
    v.null(),
    v.object({ job: schema.doc("planning_jobs"), state: v.string() }),
  ),
  handler: async (
    ctx,
    { id },
  ): Promise<{ job: Doc<"planning_jobs">; state: string } | null> => {
    for (let retry = 0; retry < 3; retry++) {
      const job: Doc<"planning_jobs"> | null = await ctx.runQuery(
        internal.planning.loadJob,
        { id },
      );
      if (!job || !["queued", "waiting"].includes(job.status)) return null;
      const read = await ctx.runAction(internal.workspaceReader.read, {
        owner: job.owner_id,
      });
      const state: Workspace = JSON.parse(read.state);
      const plan = state.dailyPlans.find((p) => p.id === job.plan_id);
      const attempt: number = await ctx.runMutation(
        internal.planning.claimJob,
        {
          id,
          sequence: read.sequence,
          completedBasis:
            plan && ["approved", "dismissed"].includes(plan.status)
              ? planningBasis(
                  state.tasks,
                  state.calendars,
                  state.planningSettings,
                  job.date,
                )
              : undefined,
        },
      );
      if (attempt === 0) return null;
      if (attempt > 0) return { job: { ...job, attempt }, state: read.state };
    }
    await ctx.scheduler.runAfter(1000, internal.planningAI.generate, { id });
    return null;
  },
});
export const claimJob = internalMutation({
  args: {
    id: v.id("planning_jobs"),
    sequence: v.number(),
    completedBasis: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { id, sequence, completedBasis }) => {
    const job = await ctx.db.get(id);
    if (!job || !["queued", "waiting"].includes(job.status)) return 0;
    if ((await workspaceSequence(ctx, job.owner_id)) !== sequence) return -1;
    if (completedBasis !== undefined) {
      await ctx.db.patch(id, { status: "finished", basis: completedBasis });
      return 0;
    }
    const attempt = job.attempt + 1;
    await ctx.db.patch(id, { status: "running", attempt });
    await ctx.scheduler.runAfter(120000, internal.planning.expire, {
      id,
      attempt,
    });
    return attempt;
  },
});
export const finish = internalAction({
  args: { id: v.id("planning_jobs"), attempt: v.number(), plan: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (let retry = 0; retry < 3; retry++) {
      const job: Doc<"planning_jobs"> | null = await ctx.runQuery(
        internal.planning.loadJob,
        { id: args.id },
      );
      if (!job || job.attempt !== args.attempt || job.status !== "running")
        return null;
      const read = await ctx.runAction(internal.workspaceReader.read, {
        owner: job.owner_id,
      });
      const state: Workspace = JSON.parse(read.state);
      const saved: boolean = await ctx.runMutation(
        internal.planning.commitPlan,
        {
          ...args,
          sequence: read.sequence,
          basis: planningBasis(
            state.tasks,
            state.calendars,
            state.planningSettings,
            job.date,
          ),
        },
      );
      if (saved) return null;
    }
    await ctx.scheduler.runAfter(1000, internal.planning.finish, args);
    return null;
  },
});
export const commitPlan = internalMutation({
  args: {
    id: v.id("planning_jobs"),
    attempt: v.number(),
    plan: v.string(),
    sequence: v.number(),
    basis: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { id, attempt, plan: raw, sequence, basis }) => {
    const job = await ctx.db.get(id);
    if (!job || job.attempt !== attempt || job.status !== "running")
      return true;
    if ((await workspaceSequence(ctx, job.owner_id)) !== sequence) return false;
    const plan = dailyPlanSchema.parse(JSON.parse(raw));
    if (plan.id !== job.plan_id || plan.date !== job.date)
      throw new Error("Invalid plan result");
    if (plan.status === "ready" && plan.basis !== basis) {
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
    return true;
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
export const preferences = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("planning_preferences")),
  handler: async (ctx, { paginationOpts }) =>
    ctx.db
      .query("planning_preferences")
      .withIndex("by_owner")
      .paginate(paginationOpts),
});
export const evaluate = internalMutation({
  args: { owner: v.id("users"), sequence: v.number(), state: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { owner, sequence, state: raw }) => {
    if ((await workspaceSequence(ctx, owner)) !== sequence) return false;
    const state: Workspace = JSON.parse(raw);
    const now = Date.now();
    const s = state.planningSettings;
    if (!s.enabled) return true;
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
          q.eq("owner_id", owner).eq("date", date),
        )
        .order("desc")
        .take(1);
      if (jobs.some((j) => ["queued", "running", "waiting"].includes(j.status)))
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
      if (
        latest &&
        (latest.basis === basis ||
          (latest.status === "dismissed" && jobs[0]?.basis === basis)) &&
        !overrun
      )
        continue;
      const planId = crypto.randomUUID();
      await publish(ctx, owner, {
        type: "planning.request",
        planId,
        date,
      });
      await enqueue(ctx, owner, planId, date, basis);
    }

    return true;
  },
});
export const tick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let cursor: string | null = null;
    do {
      const page: import("convex/server").PaginationResult<
        Doc<"planning_preferences">
      > = await ctx.runQuery(internal.planning.preferences, {
        paginationOpts: { cursor, numItems: 20, maximumBytesRead: 500_000 },
      });
      for (const pref of page.page) {
        // Disabled planning needs no history replay.
        if (!JSON.parse(pref.settings).enabled) continue;
        for (let retry = 0; retry < 3; retry++) {
          const read = await ctx.runAction(internal.workspaceReader.read, {
            owner: pref.owner_id,
          });
          const saved: boolean = await ctx.runMutation(
            internal.planning.evaluate,
            { owner: pref.owner_id, ...read },
          );
          if (saved) break;
        }
      }
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    await ctx.runMutation(internal.planning.resume, {});
    return null;
  },
});
export const resume = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
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
