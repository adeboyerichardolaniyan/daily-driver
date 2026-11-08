import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { actionSchema, type Action } from "../src/domain/workspace";
import { aiRequestSchema } from "../src/domain/ai";

async function publish(ctx: MutationCtx, job: Doc<"ai_jobs">, action: Action) {
  const last = await ctx.db
    .query("workspace_events")
    .withIndex("by_owner_id_and_clock", (q) => q.eq("owner_id", job.owner_id))
    .order("desc")
    .first();
  const head = await ctx.db
    .query("workspace_heads")
    .withIndex("by_owner", (q) => q.eq("owner_id", job.owner_id))
    .unique();
  const sequence = (head?.sequence ?? 0) + 1;
  await ctx.db.insert("workspace_events", {
    uuid: crypto.randomUUID(),
    owner_id: job.owner_id,
    actor_id: "ai-server",
    clock: (last?.clock ?? 0) + 1,
    created_at: new Date().toISOString(),
    payload: JSON.stringify(action),
    sequence,
  });
  if (head) await ctx.db.patch(head._id, { sequence });
  else
    await ctx.db.insert("workspace_heads", {
      owner_id: job.owner_id,
      sequence,
    });
}

// Called in the same transaction as event upload: replay cannot enqueue twice.
export async function receiveAIAction(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  if (!("requestId" in action) || !action.type.startsWith("ai.")) return;
  const job = await ctx.db
    .query("ai_jobs")
    .withIndex("by_request_id", (q) => q.eq("request_id", action.requestId))
    .unique();
  if (job && job.owner_id !== owner)
    throw new Error("Request belongs to another workspace.");
  if (action.type === "ai.request") {
    if (job) throw new Error("Request already exists.");
    const id = await ctx.db.insert("ai_jobs", {
      request_id: action.requestId,
      owner_id: owner,
      request: JSON.stringify(action),
      status: "queued",
    });
    await ctx.scheduler.runAfter(0, internal.ai.generate, { id });
  } else if (action.type === "ai.cancel" && job) {
    await ctx.db.patch(job._id, { status: "canceled" });
  }
}

export const claim = internalMutation({
  args: { id: v.id("ai_jobs") },
  handler: async (
    ctx,
    { id },
  ): Promise<{ request: string; attempt: number } | null> => {
    const job = await ctx.db.get(id);
    if (!job || !["queued", "waiting"].includes(job.status)) return null;
    const attempt = (job.attempt ?? 0) + 1;
    await ctx.db.patch(id, { status: "running", attempt });
    await publish(ctx, job, { type: "ai.running", requestId: job.request_id });
    await ctx.scheduler.runAfter(120_000, internal.aiJobs.expire, {
      id,
      attempt,
    });
    return { request: job.request, attempt };
  },
});

export const finish = internalMutation({
  args: { id: v.id("ai_jobs"), attempt: v.number(), payload: v.string() },
  handler: async (ctx, { id, attempt, payload }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "running" || job.attempt !== attempt) return;
    const action = actionSchema.parse(JSON.parse(payload));
    if (
      !["ai.ready", "ai.failed", "ai.waiting"].includes(action.type) ||
      !("requestId" in action) ||
      action.requestId !== job.request_id
    )
      throw new Error("Invalid result.");
    await ctx.db.patch(id, {
      status: action.type === "ai.waiting" ? "waiting" : "finished",
    });
    await publish(ctx, job, action);
  },
});
export const expire = internalMutation({
  args: { id: v.id("ai_jobs"), attempt: v.number() },
  handler: async (ctx, { id, attempt }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "running" || job.attempt !== attempt) return;
    await ctx.db.patch(id, { status: "finished" });
    await publish(ctx, job, {
      type: "ai.failed",
      requestId: job.request_id,
      error: "Generation timed out. Try again.",
    });
  },
});
export const resumeWaiting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("ai_jobs")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .take(10);
    for (const job of jobs) {
      aiRequestSchema.parse(JSON.parse(job.request));
      await ctx.db.patch(job._id, { status: "queued" });
      await ctx.scheduler.runAfter(0, internal.ai.generate, { id: job._id });
    }
  },
});
