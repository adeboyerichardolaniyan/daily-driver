import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Action } from "../src/domain/workspace";

// A deleted request must not be resumed by the waiting-job cron.
export async function receiveDeletion(
  ctx: MutationCtx,
  owner: Id<"users">,
  action: Action,
) {
  if (action.type !== "object.delete") return;
  if (action.kind === "proposal") {
    const job = await ctx.db
      .query("ai_jobs")
      .withIndex("by_request_id", (q) => q.eq("request_id", action.id))
      .unique();
    if (job?.owner_id === owner && job.status !== "finished")
      await ctx.db.patch(job._id, { status: "canceled" });
  }
  if (action.kind === "contentRequest") {
    const job = await ctx.db
      .query("content_jobs")
      .withIndex("by_request_id", (q) => q.eq("request_id", action.id))
      .unique();
    if (job?.owner_id === owner)
      await ctx.db.patch(job._id, { status: "finished" });
  }
  if (action.kind === "plan") {
    const job = await ctx.db
      .query("planning_jobs")
      .withIndex("by_plan", (q) => q.eq("plan_id", action.id))
      .unique();
    if (job?.owner_id === owner)
      await ctx.db.patch(job._id, { status: "finished" });
  }
}
