"use node";
import ical from "node-ical";
import { createHash } from "node:crypto";
import { atTime, type CalendarEvent } from "../src/domain/planning";
function text(value: unknown) {
  return typeof value === "string"
    ? value
    : value && typeof value === "object" && "val" in value
      ? String(value.val)
      : "";
}
export function parseCalendar(
  input: string,
  from: number,
  to: number,
  timeZone: string,
): CalendarEvent[] {
  if (!input.includes("BEGIN:VCALENDAR") || !input.includes("END:VCALENDAR"))
    throw new Error("Not an iCalendar feed");
  const data = ical.sync.parseICS(input);
  const events: CalendarEvent[] = [];
  for (const event of Object.values(data)) {
    if (!event || event.type !== "VEVENT" || event.recurrenceid) continue;
    for (const instance of ical.expandRecurringEvent(event, {
      from: new Date(from),
      to: new Date(to),
      expandOngoing: true,
      maxIterations: 10000,
    })) {
      const item = instance.event;
      if (item.status === "CANCELLED") continue;
      const localDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const localTime = (d: Date) =>
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      const startDate = localDate(instance.start),
        endDate = localDate(instance.end);
      const millis = (date: typeof instance.start) =>
        date.tz || instance.isFullDay
          ? date.getTime()
          : atTime(localDate(date), localTime(date), timeZone);
      const start = millis(instance.start),
        end = millis(instance.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        continue;
      events.push({
        id: `${createHash("sha256").update(event.uid).digest("hex")}:${instance.start.toISOString()}`,
        title: text(instance.summary).slice(0, 500) || "Busy",
        start,
        end,
        allDay: instance.isFullDay,
        busy: item.transparency !== "TRANSPARENT",
        ...(instance.isFullDay ? { startDate, endDate } : {}),
      });
      if (events.length > 2000)
        throw new Error("Calendar has too many events in this window");
    }
  }
  return events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
