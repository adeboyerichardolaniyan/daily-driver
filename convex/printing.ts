import { v } from "convex/values";
import { z } from "zod";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireOwner, requireWorker } from "./access";
import { receiptSchema } from "../src/domain/receipt-schema";
const credentials = { secret: v.string(), worker: v.string() };
const outcome = v.union(
  v.literal("dispatched"),
  v.literal("rendered"),
  v.literal("failed"),
  v.literal("uncertain"),
);
export const enqueue = mutation({
  args: { id: v.string(), snapshot: v.string() },
  handler: async (ctx, { id, snapshot }) => {
    const owner_id = await requireOwner(ctx);
    z.string().uuid().parse(id);
    if (new TextEncoder().encode(snapshot).length > 500_000)
      throw new Error("Receipt is too large.");
    receiptSchema.parse(JSON.parse(snapshot));
    const existing = await ctx.db
      .query("print_jobs")
      .withIndex("by_uuid", (q) => q.eq("uuid", id))
      .unique();
    if (existing?.deleted)
      throw new Error(
        "This print job was deleted. Create a new job to print again.",
      );
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
      output: "printer",
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
      .withIndex("by_owner_and_deleted", (q) =>
        q.eq("owner_id", owner).eq("deleted", undefined),
      )
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
      .withIndex("by_owner_id_and_worker_id_and_status", (q) =>
        q
          .eq("owner_id", owner)
          .eq("worker_id", worker)
          .eq("status", "processing"),
      )
      .take(10);
    return jobs.map((j) => ({ id: j.uuid }));
  },
});
export const claim = mutation({
  args: {
    ...credentials,
    output: v.optional(v.union(v.literal("pdf"), v.literal("printer"))),
  },
  handler: async (ctx, { secret, worker, output = "printer" }) => {
    const owner = await requireWorker(ctx, secret);
    if (!worker || worker.length > 200) throw new Error("Invalid worker ID.");
    const job =
      (await ctx.db
        .query("print_jobs")
        .withIndex("by_owner_id_and_status_and_output", (q) =>
          q.eq("owner_id", owner).eq("status", "queued").eq("output", output),
        )
        .first()) ??
      (output === "printer"
        ? await ctx.db
            .query("print_jobs")
            .withIndex("by_owner_id_and_status_and_output", (q) =>
              q
                .eq("owner_id", owner)
                .eq("status", "queued")
                .eq("output", undefined),
            )
            .first()
        : null);
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

// Administrative recovery only: never replay a physical or uncertain dispatch.
export const retryFailedPdf = internalMutation({
  args: { id: v.string() },
  returns: v.string(),
  handler: async (ctx, { id }) => {
    const original = await ctx.db
      .query("print_jobs")
      .withIndex("by_uuid", (q) => q.eq("uuid", id))
      .unique();
    if (
      !original ||
      original.deleted ||
      original.output !== "pdf" ||
      original.status !== "failed"
    )
      throw new Error("Only failed PDF jobs can be retried here.");
    if (original.retry_id) return original.retry_id;
    const retry = crypto.randomUUID();
    await ctx.db.insert("print_jobs", {
      uuid: retry,
      owner_id: original.owner_id,
      snapshot: original.snapshot,
      output: "pdf",
      status: "queued",
      created_at: new Date().toISOString(),
      error: null,
    });
    await ctx.db.patch(original._id, { retry_id: retry });
    return retry;
  },
});

// Retain the ID as a tombstone so stale retries cannot reprint a deleted job.
export const remove = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const owner = await requireOwner(ctx);
    const job = await ctx.db
      .query("print_jobs")
      .withIndex("by_uuid", (q) => q.eq("uuid", id))
      .unique();
    if (!job || job.owner_id !== owner) throw new Error("Print job not found.");
    if (job.status === "processing")
      throw new Error(
        "This job is being processed. Wait for it to finish before deleting.",
      );
    await ctx.db.patch(job._id, {
      deleted: true,
      snapshot: "",
      error: null,
      status: job.status === "queued" ? "failed" : job.status,
    });
    return null;
  },
});
