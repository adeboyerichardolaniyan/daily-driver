import { z } from "zod";
import { atTime, nextDate, zonedDate } from "./planning";
export const briefingScheduleSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  output: z.enum(["pdf", "printer"]),
  appUrl: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      );
    }, "Use a public HTTPS app URL."),
});
export type BriefingSchedule = z.infer<typeof briefingScheduleSchema>;
export const defaultBriefingSchedule = (): BriefingSchedule => ({
  enabled: false,
  time: "07:00",
  output: "pdf",
  appUrl: "https://example.invalid",
});
export function nextBriefingTime(
  now: number,
  time: string,
  zone: string,
  completedDay?: string,
) {
  const today = zonedDate(now, zone);
  if (completedDay === today) return atTime(nextDate(today), time, zone);
  return Math.max(now, atTime(today, time, zone));
}
