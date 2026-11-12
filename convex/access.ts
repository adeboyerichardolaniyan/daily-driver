import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "./_generated/server";
export async function requireOwner(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (
    !userId ||
    !(await ctx.db
      .query("app_members")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .unique())
  )
    throw new Error("This account does not have workspace access.");
  return userId;
}
export async function requireWorker(ctx: QueryCtx, secret: string) {
  const expected = process.env.PRINT_WORKER_SECRET;
  if (!expected || expected.length < 32 || secret !== expected)
    throw new Error("Worker authentication failed.");
  // A personal deployment has exactly one owner. Bound the invariant check.
  const members = await ctx.db
    .query("app_members")
    .withIndex("by_user")
    .take(2);
  if (members.length > 1)
    throw new Error("Worker requires a single workspace owner.");
  const member = members[0];
  if (!member) throw new Error("Provision the workspace owner first.");
  return member.user_id;
}
