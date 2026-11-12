import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
export const grantOwner = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("app_members")
      .withIndex("by_user")
      .first();
    if (existing && existing.user_id !== userId)
      throw new Error("This personal workspace already has an owner.");
    if (!existing) await ctx.db.insert("app_members", { user_id: userId });
  },
});
// Run from the authenticated Convex dashboard, never from a public client.
export const provisionOwner = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<string> => {
    if (password.length < 12) throw new Error("Use at least 12 characters.");
    const normalized = email.trim().toLowerCase();
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: password },
      profile: { email: normalized },
    });
    await ctx.runMutation(internal.admin.grantOwner, { userId: user._id });
    return user._id;
  },
});
