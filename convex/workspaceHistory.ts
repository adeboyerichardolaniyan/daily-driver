import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function workspaceSequence(ctx: QueryCtx, owner: Id<"users">) {
  const head = await ctx.db
    .query("workspace_heads")
    .withIndex("by_owner", (q) => q.eq("owner_id", owner))
    .unique();
  return head?.sequence ?? 0;
}
export const revision = internalQuery({
  args: { owner: v.id("users") },
  returns: v.number(),
  handler: (ctx, { owner }) => workspaceSequence(ctx, owner),
});
const event = v.object({
  id: v.string(),
  actor_id: v.string(),
  clock: v.number(),
  created_at: v.string(),
  payload: v.string(),
});
// History is immutable. Pin the sequence so writes between pages cannot mix
// workspace revisions. Legacy events without a sequence sort before numbers.
export const page = internalQuery({
  args: {
    owner: v.id("users"),
    sequence: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(event),
  handler: async (ctx, { owner, sequence, paginationOpts }) => {
    const result = await ctx.db
      .query("workspace_events")
      .withIndex("by_owner_sequence", (q) =>
        q.eq("owner_id", owner).lte("sequence", sequence),
      )
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((e) => ({
        id: e.uuid,
        actor_id: e.actor_id,
        clock: e.clock,
        created_at: e.created_at,
        payload: e.payload,
      })),
    };
  },
});
