import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { Action } from "../src/domain/workspace";
import { contentResultSchema } from "../src/domain/content-collections";
import { publish } from "./publish";
export async function receiveContentAction(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  if (action.type !== "content.request") return;
  const existing = await ctx.db
    .query("content_jobs")
    .withIndex("by_request_id", (q) => q.eq("request_id", action.requestId))
    .unique();
  if (existing) throw new Error("Content request already exists.");
  const id = await ctx.db.insert("content_jobs", {
    request_id: action.requestId,
    owner_id: owner,
    request: JSON.stringify(action),
    attempt: 0,
    status: "queued",
  });
  await ctx.scheduler.runAfter(0, internal.contentAI.generate, { id });
}
export const claim = internalMutation({
  args: { id: v.id("content_jobs") },
  returns: v.union(
    v.null(),
    v.object({
      request: v.string(),
      attempt: v.number(),
      owner: v.id("users"),
    }),
  ),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id);
    if (!job || !["queued", "waiting"].includes(job.status)) return null;
    const attempt = job.attempt + 1;
    await ctx.db.patch(id, { status: "running", attempt });
    await publish(ctx, job.owner_id, {
      type: "content.result",
      requestId: job.request_id,
      status: "running",
      entries: [],
      message: "Preparing entries for review.",
    });
    await ctx.scheduler.runAfter(120000, internal.contentJobs.expire, {
      id,
      attempt,
    });
    return { request: job.request, attempt, owner: job.owner_id };
  },
});
export const finish = internalMutation({
  args: { id: v.id("content_jobs"), attempt: v.number(), payload: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, attempt, payload }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "running" || job.attempt !== attempt)
      return null;
    const action = contentResultSchema.parse(JSON.parse(payload));
    if (action.requestId !== job.request_id || action.status === "running")
      throw new Error("Invalid content result.");
    action.entries = action.entries.map((entry) => ({
      ...entry,
      approved: false,
    }));
    await ctx.db.patch(id, {
      status: action.status === "waiting" ? "waiting" : "finished",
    });
    await publish(ctx, job.owner_id, action);
    return null;
  },
});
export const expire = internalMutation({
  args: { id: v.id("content_jobs"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, attempt }) => {
    const job = await ctx.db.get(id);
    if (!job || job.status !== "running" || job.attempt !== attempt)
      return null;
    await ctx.db.patch(id, { status: "finished" });
    await publish(ctx, job.owner_id, {
      type: "content.result",
      requestId: job.request_id,
      status: "failed",
      entries: [],
      message: "Generation timed out. Try again.",
    });
    return null;
  },
});
export const resume = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!process.env.OPENAI_API_KEY) return null;
    const jobs = await ctx.db
      .query("content_jobs")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .take(10);
    for (const job of jobs) {
      await ctx.db.patch(job._id, { status: "queued" });
      await ctx.scheduler.runAfter(0, internal.contentAI.generate, {
        id: job._id,
      });
    }
    return null;
  },
});
