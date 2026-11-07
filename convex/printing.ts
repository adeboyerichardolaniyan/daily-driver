import { v } from "convex/values";
import { z } from "zod";
import { mutation, query } from "./_generated/server";
import { requireOwner, requireWorker } from "./access";
import { receiptSchema } from "../src/domain/receipt-schema";
const credentials = { secret: v.string(), worker: v.string() };
const outcome = v.union(
  v.literal("dispatched"),
  v.literal("failed"),
  v.literal("uncertain"),
);
export const enqueue = mutation({
  args: { id: v.string(), snapshot: v.string() },
  handler: async (ctx, { id, snapshot }) => {
    const owner_id = await requireOwner(ctx);
    z.string().uuid().parse(id);
    receiptSchema.parse(JSON.parse(snapshot));
    const existing = await ctx.db
      .query("print_jobs")
      .withIndex("by_uuid", (q) => q.eq("uuid", id))
      .unique();
    if (existing) {
      if (existing.owner_id !== owner_id || existing.snapshot !== snapshot)
        throw new Error("Print ID collision.");
      return id;
    }
    await ctx.db.insert("print_jobs", {
      uuid: id,
      owner_id,
      snapshot,
      status: "queued",
      created_at: new Date().toISOString(),
      error: null,
    });
    return id;
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const jobs = await ctx.db
      .query("print_jobs")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .order("desc")
      .take(10);
    return jobs.map((j) => ({
      id: j.uuid,
      status: j.status,
      created_at: j.created_at,
      error: j.error,
    }));
  },
});
export const interrupted = query({
  args: credentials,
  handler: async (ctx, { secret, worker }) => {
    const owner = await requireWorker(ctx, secret);
    const jobs = await ctx.db
      .query("print_jobs")
      .withIndex("by_worker_status", (q) =>
        q.eq("worker_id", worker).eq("status", "processing"),
      )
      .collect();
    return jobs
      .filter((j) => j.owner_id === owner)
      .map((j) => ({ id: j.uuid }));
  },
});
export const claim = mutation({
  args: credentials,
  handler: async (ctx, { secret, worker }) => {
    const owner = await requireWorker(ctx, secret);
    if (!worker || worker.length > 200) throw new Error("Invalid worker ID.");
    const job = await ctx.db
      .query("print_jobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first();
    if (!job) return null;
    if (job.owner_id !== owner) throw new Error("Job owner mismatch.");
    await ctx.db.patch(job._id, { status: "processing", worker_id: worker });
    return { id: job.uuid, snapshot: JSON.parse(job.snapshot) as unknown };
  },
});
export const finish = mutation({
  args: {
    ...credentials,
    id: v.string(),
    outcome,
    detail: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { secret, worker, id, outcome, detail }) => {
    const owner = await requireWorker(ctx, secret);
    const job = await ctx.db
      .query("print_jobs")
      .withIndex("by_uuid", (q) => q.eq("uuid", id))
      .unique();
    if (!job || job.owner_id !== owner || job.worker_id !== worker)
      throw new Error("Job is not assigned to this worker.");
    if (job.status === outcome) return;
    if (job.status !== "processing")
      throw new Error("A terminal print result cannot be changed.");
    await ctx.db.patch(job._id, {
      status: outcome,
      error: detail?.slice(0, 500) ?? null,
    });
  },
});
