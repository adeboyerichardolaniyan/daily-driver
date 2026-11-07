import { v } from "convex/values";
import { z } from "zod";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";
import { actionSchema } from "../src/domain/workspace";
const event = v.object({
  id: v.string(),
  actor_id: v.string(),
  clock: v.number(),
  created_at: v.string(),
  payload: v.string(),
});
export const account = query({
  args: {},
  handler: async (ctx) => {
    const id = await requireOwner(ctx);
    const user = await ctx.db.get(id);
    return { id, label: user?.email ?? id };
  },
});
export const appendEvents = mutation({
  args: { events: v.array(event) },
  handler: async (ctx, { events }) => {
    const owner_id = await requireOwner(ctx);
    if (events.length > 1000) throw new Error("Upload batch is too large.");
    for (const e of events) {
      z.string().uuid().parse(e.id);
      if (
        !e.actor_id ||
        e.actor_id.length > 200 ||
        !Number.isSafeInteger(e.clock) ||
        e.clock < 1 ||
        !Number.isFinite(Date.parse(e.created_at)) ||
        e.payload.length > 50000
      )
        throw new Error("Invalid event metadata.");
      actionSchema.parse(JSON.parse(e.payload));
      const existing = await ctx.db
        .query("workspace_events")
        .withIndex("by_uuid", (q) => q.eq("uuid", e.id))
        .unique();
      if (existing) {
        if (
          existing.owner_id !== owner_id ||
          existing.actor_id !== e.actor_id ||
          existing.clock !== e.clock ||
          existing.created_at !== e.created_at ||
          existing.payload !== e.payload
        )
          throw new Error(
            "Event ID collision: existing history cannot be changed.",
          );
      } else {
        const { id, ...fields } = e;
        await ctx.db.insert("workspace_events", {
          ...fields,
          uuid: id,
          owner_id,
        });
      }
    }
  },
});
