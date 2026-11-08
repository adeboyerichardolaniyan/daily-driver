import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchWeather } from "../src/data/weather";
import type { WeatherLocation } from "../src/domain/weather";
export const prepare = internalAction({
  args: { id: v.id("briefing_schedules"), version: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const context: {
        day: string;
        zone: string;
        weather: WeatherLocation | null;
      } | null = await ctx.runQuery(internal.briefings.context, {
        ...args,
        now: Date.now(),
      });
      if (!context) return null;
      let weather: string | undefined, warning: string | undefined;
      if (context.weather) {
        try {
          weather = JSON.stringify(
            await fetchWeather(context.weather, context.zone),
          );
        } catch {
          warning =
            "Weather refresh failed. The briefing uses today's cached weather if available.";
        }
      }
      await ctx.runMutation(internal.briefings.complete, {
        ...args,
        day: context.day,
        weather,
        warning,
      });
    } catch (error) {
      await ctx.runMutation(internal.briefings.failed, {
        ...args,
        message:
          error instanceof Error
            ? error.message
            : "Briefing preparation failed.",
      });
    }
    return null;
  },
});
