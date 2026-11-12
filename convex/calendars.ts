import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwner } from "./access";
import { publish } from "./publish";
import { calendarFeedUrl } from "../src/domain/feed-url";
import { calendarSnapshotSchema } from "../src/domain/planning";
export const add = mutation({
  args: { name: v.string(), url: v.string() },
  returns: v.id("calendar_sources"),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name || name.length > 100)
      throw new Error("Give this calendar a name.");
    const url = calendarFeedUrl(args.url);
    const existing = await ctx.db
      .query("calendar_sources")
      .withIndex("by_owner", (q) => q.eq("owner_id", owner))
      .take(11);
    if (existing.length >= 10)
      throw new Error("You can connect up to 10 calendars.");
    if (existing.some((s) => s.url === url))
      throw new Error("This calendar is already connected.");
    const id = await ctx.db.insert("calendar_sources", {
      owner_id: owner,
      name,
      url,
      snapshot: "",
      nextRefresh: Date.now() + 15 * 60000,
      version: 1,
    });
    const source = {
      id,
      name,
      events: [],
      refreshedAt: null,
      error: "Waiting for the first refresh.",
      rangeStart: 0,
      rangeEnd: 0,
    };
    await ctx.db.patch(id, { snapshot: JSON.stringify(source) });
    await publish(ctx, owner, { type: "calendar.snapshot", source });
    await ctx.scheduler.runAfter(0, internal.calendarFetch.refresh, {
      id,
      version: 1,
    });
    return id;
  },
});
export const refresh = mutation({
  args: { id: v.id("calendar_sources") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const owner = await requireOwner(ctx);
    const source = await ctx.db.get(id);
    if (!source || source.owner_id !== owner)
      throw new Error("Calendar not found.");
    // Prevent concurrent refreshes; a failed worker is retried by the periodic job.
    if (source.nextRefresh > Date.now() + 14 * 60000) return null;
    const version = source.version + 1;
    await ctx.db.patch(id, { version, nextRefresh: Date.now() + 15 * 60000 });
    await ctx.scheduler.runAfter(0, internal.calendarFetch.refresh, {
      id,
      version,
    });
    return null;
  },
});
export const remove = mutation({
  args: { id: v.id("calendar_sources") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const owner = await requireOwner(ctx);
    const source = await ctx.db.get(id);
    if (!source || source.owner_id !== owner)
      throw new Error("Calendar not found.");
    await ctx.db.delete(id);
    await publish(ctx, owner, { type: "calendar.remove", sourceId: id });
    return null;
  },
});
export const load = internalQuery({
  args: { id: v.id("calendar_sources"), version: v.number() },
  returns: v.any(),
  handler: async (ctx, { id, version }) => {
    const source = await ctx.db.get(id);
    if (!source || source.version !== version) return null;
    const pref = await ctx.db
      .query("planning_preferences")
      .withIndex("by_owner", (q) => q.eq("owner_id", source.owner_id))
      .unique();
    return {
      ...source,
      timeZone: pref ? JSON.parse(pref.settings).timeZone : "America/New_York",
    };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("calendar_sources"),
    version: v.number(),
    snapshot: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, version, snapshot }) => {
    const current = await ctx.db.get(id);
    if (!current || current.version !== version) return null;
    const source = calendarSnapshotSchema.parse(JSON.parse(snapshot));
    if (source.id !== id) throw new Error("Invalid calendar result.");
    await ctx.db.patch(id, { snapshot: JSON.stringify(source) });
    await publish(ctx, current.owner_id, { type: "calendar.snapshot", source });
    return null;
  },
});
export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.db
      .query("calendar_sources")
      .withIndex("by_refresh", (q) => q.lte("nextRefresh", Date.now()))
      .paginate({ cursor: null, numItems: 20, maximumBytesRead: 500_000 });
    for (const source of due.page) {
      const version = source.version + 1;
      await ctx.db.patch(source._id, {
        version,
        nextRefresh: Date.now() + 15 * 60000,
      });
      await ctx.scheduler.runAfter(0, internal.calendarFetch.refresh, {
        id: source._id,
        version,
      });
    }
    return null;
  },
});
