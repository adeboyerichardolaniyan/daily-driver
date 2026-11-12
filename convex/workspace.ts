import { receiveDeletion } from "./deletion";
import { receiveBriefingAction, validateBriefingAction } from "./briefings";
import { receiveContentAction } from "./contentJobs";
import { receivePlanningAction } from "./planning";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { z } from "zod";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./access";
import { receiveAIAction } from "./aiJobs";
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
  returns: v.object({ id: v.id("users"), label: v.string() }),
  handler: async (ctx) => {
    const id = await requireOwner(ctx);
    const user = await ctx.db.get(id);
    return { id, label: user?.email ?? id };
  },
});
export const appendEvents = mutation({
  args: { events: v.array(event) },
  returns: v.null(),
  handler: async (ctx, { events }) => {
    const owner_id = await requireOwner(ctx);
    if (
      events.length > 100 ||
      events.reduce(
        (bytes, e) => bytes + new TextEncoder().encode(e.payload).length,
        0,
      ) > 2_000_000
    )
      throw new Error("Upload batch is too large.");
    const head = await ctx.db
      .query("workspace_heads")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner_id))
      .unique();
    let sequence = head?.sequence ?? 0;
    let settingsChanged = false;
    for (const e of events) {
      z.string().uuid().parse(e.id);
      if (
        !e.actor_id ||
        e.actor_id.length > 200 ||
        !Number.isSafeInteger(e.clock) ||
        e.clock < 1 ||
        !Number.isFinite(Date.parse(e.created_at)) ||
        new TextEncoder().encode(e.payload).length > 50000
      )
        throw new Error("Invalid event metadata.");
      const action = actionSchema.parse(JSON.parse(e.payload));
      validateBriefingAction(action);
      if (
        [
          "ai.running",
          "ai.waiting",
          "ai.ready",
          "ai.failed",
          "calendar.snapshot",
          "calendar.remove",
          "planning.result",
          "content.result",
        ].includes(action.type)
      )
        throw new Error("AI results can only be written by the server.");
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
        await receiveDeletion(ctx, owner_id, action);
        await receiveContentAction(ctx, owner_id, action);
        await receiveAIAction(ctx, owner_id, action);
        await receivePlanningAction(ctx, owner_id, action);
        const { id, ...fields } = e;
        await ctx.db.insert("workspace_events", {
          ...fields,
          uuid: id,
          owner_id,
          sequence: ++sequence,
        });
        settingsChanged ||=
          action.type === "briefing.schedule" ||
          action.type === "planning.settings";
      }
    }
    if (sequence !== (head?.sequence ?? 0)) {
      if (head) await ctx.db.patch(head._id, { sequence });
      else await ctx.db.insert("workspace_heads", { owner_id, sequence });
    }
    if (settingsChanged) await receiveBriefingAction(ctx, owner_id);
    return null;
  },
});

// Initial bounded snapshot also includes events written before direct sync existed.
// New events concurrently created during bootstrap are replayed by sequence afterward.
export const bootstrapPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(event),
  handler: async (ctx, { paginationOpts }) => {
    const owner = await requireOwner(ctx);
    const result = await ctx.db
      .query("workspace_events")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .paginate({
        ...paginationOpts,
        numItems: Math.min(50, paginationOpts.numItems),
        maximumBytesRead: 500_000,
      });
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
export const head = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const head = await ctx.db
      .query("workspace_heads")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .unique();
    return head?.sequence ?? 0;
  },
});
export const changes = query({
  args: { after: v.number() },
  returns: v.array(v.object({ ...event.fields, sequence: v.number() })),
  handler: async (ctx, { after }) => {
    const owner = await requireOwner(ctx);
    if (!Number.isSafeInteger(after) || after < 0)
      throw new Error("Invalid sync cursor.");
    const rows = await ctx.db
      .query("workspace_events")
      .withIndex("by_owner_sequence", (q) =>
        q.eq("owner_id", owner).gt("sequence", after),
      )
      .paginate({ cursor: null, numItems: 20, maximumBytesRead: 500_000 });
    return rows.page.map((e) => ({
      id: e.uuid,
      actor_id: e.actor_id,
      clock: e.clock,
      created_at: e.created_at,
      payload: e.payload,
      sequence: e.sequence!,
    }));
  },
});
