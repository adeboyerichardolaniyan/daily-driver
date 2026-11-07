import { mutation } from "./_generated/server";
// PowerSync's documented public checkpoint protocol carries no end-user JWT.
// This singleton contains no user data and can only advance its own timestamp.
export const createCheckpoint = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("powersync_checkpoints").first();
    if (existing)
      await ctx.db.patch(existing._id, { last_updated: Date.now() });
    else
      await ctx.db.insert("powersync_checkpoints", {
        last_updated: Date.now(),
      });
  },
});
