"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { calendarFeedUrl } from "../src/domain/feed-url";
import {
  calendarSnapshotSchema,
  atTime,
  zonedDate,
} from "../src/domain/planning";
import { parseCalendar } from "./ical";
export const refresh = internalAction({
  args: { id: v.id("calendar_sources"), version: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.runQuery(internal.calendars.load, args);
    if (!source) return null;
    const old = calendarSnapshotSchema.parse(JSON.parse(source.snapshot));
    try {
      let url = calendarFeedUrl(source.url);
      let response: Response | undefined;
      for (let redirects = 0; redirects < 4; redirects++) {
        response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error();
          url = calendarFeedUrl(new URL(location, url).toString());
          continue;
        }
        break;
      }
      if (!response?.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const now = Date.now();
      const from = atTime(
          zonedDate(now - 86400000, source.timeZone),
          "00:00",
          source.timeZone,
        ),
        to = from + 47 * 86400000;
      const events = parseCalendar(
        new TextDecoder().decode(bytes),
        from,
        to,
        source.timeZone,
      );
      if (new TextEncoder().encode(JSON.stringify(events)).length > 600000)
        throw new Error("Calendar window too large");
      await ctx.runMutation(internal.calendars.finish, {
        ...args,
        snapshot: JSON.stringify({
          ...old,
          events,
          timeZone: source.timeZone,
          refreshedAt: now,
          error: null,
          rangeStart: from,
          rangeEnd: to,
        }),
      });
    } catch {
      // Feed URLs can contain credentials. Never include fetch/parser errors in logs or client state.
      await ctx.runMutation(internal.calendars.finish, {
        ...args,
        snapshot: JSON.stringify({
          ...old,
          error:
            "Could not refresh this calendar. Check its subscription link or try again.",
        }),
      });
    }
    return null;
  },
});
