import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Task } from "./workspace";

export const planningSettingsSchema = z
  .object({
    enabled: z.boolean(),
    timeZone: z.string().refine((zone) => {
      try {
        Temporal.Now.zonedDateTimeISO(zone);
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid IANA timezone"),
    workStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    workEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    eveningTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    workDays: z.array(z.number().int().min(1).max(7)).max(7),
    bufferMinutes: z.number().int().min(0).max(60),
    reserveMinutes: z.number().int().min(0).max(480),
    allDayBusy: z.boolean(),
  })
  .refine((s) => s.workStart < s.workEnd, "Work end must be after work start");
export type PlanningSettings = z.infer<typeof planningSettingsSchema>;
export function defaultPlanningSettings(
  timeZone = "America/New_York",
): PlanningSettings {
  return {
    enabled: false,
    timeZone,
    workStart: "09:00",
    workEnd: "17:00",
    eveningTime: "19:00",
    workDays: [1, 2, 3, 4, 5],
    bufferMinutes: 10,
    reserveMinutes: 60,
    allDayBusy: true,
  };
}
export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string().max(500),
  start: z.number(),
  end: z.number(),
  allDay: z.boolean(),
  busy: z.boolean(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export const calendarSnapshotSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  events: z.array(calendarEventSchema).max(2000),
  timeZone: z.string().optional(),
  refreshedAt: z.number().nullable(),
  error: z.string().nullable(),
  rangeStart: z.number(),
  rangeEnd: z.number(),
});
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export const planBlockSchema = z.object({
  taskId: z.string(),
  start: z.number(),
  end: z.number(),
  reason: z.string().max(500),
});
export type PlanBlock = z.infer<typeof planBlockSchema>;
export const dailyPlanSchema = z.object({
  id: z.string().uuid(),
  date: z.iso.date(),
  basis: z.string(),
  createdAt: z.number(),
  status: z.enum([
    "queued",
    "ready",
    "waiting",
    "failed",
    "approved",
    "dismissed",
  ]),
  blocks: z.array(planBlockSchema).max(100),
  availableMinutes: z.number(),
  message: z.string().max(1000),
});
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export const planningActions = [
  z.object({
    type: z.literal("planning.settings"),
    settings: planningSettingsSchema,
  }),
  z.object({
    type: z.literal("calendar.snapshot"),
    source: calendarSnapshotSchema,
  }),
  z.object({ type: z.literal("calendar.remove"), sourceId: z.string() }),
  z.object({
    type: z.literal("planning.request"),
    planId: z.string().uuid(),
    date: z.iso.date(),
  }),
  z.object({ type: z.literal("planning.result"), plan: dailyPlanSchema }),
  z.object({
    type: z.literal("planning.approve"),
    planId: z.string().uuid(),
    taskIds: z.array(z.string()).max(100),
  }),
  z.object({ type: z.literal("planning.dismiss"), planId: z.string().uuid() }),
] as const;
export function zonedDate(now: number, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function nextDate(date: string) {
  return Temporal.PlainDate.from(date).add({ days: 1 }).toString();
}
export function atTime(date: string, time: string, zone: string) {
  return Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: zone,
    plainTime: time,
  }).epochMilliseconds;
}
export function calendarEventsForDay(
  sources: CalendarSnapshot[],
  date: string,
  zone: string,
) {
  const start = atTime(date, "00:00", zone),
    end = atTime(nextDate(date), "00:00", zone);
  return sources
    .flatMap((source) =>
      source.events
        .filter((e) =>
          e.allDay && e.startDate && e.endDate
            ? e.startDate <= date && e.endDate > date
            : e.start < end && e.end > start,
        )
        .map((event) => ({ ...event, sourceName: source.name })),
    )
    .sort((a, b) => a.start - b.start);
}
export function calendarWarnings(
  sources: CalendarSnapshot[],
  date: string,
  settings: PlanningSettings,
  now: number,
) {
  const end = atTime(nextDate(date), "00:00", settings.timeZone);
  const start = atTime(date, "00:00", settings.timeZone);
  return sources.filter(
    (s) =>
      s.error ||
      (s.timeZone !== undefined && s.timeZone !== settings.timeZone) ||
      s.refreshedAt === null ||
      now - s.refreshedAt > 2 * 60 * 60 * 1000 ||
      s.rangeStart > start ||
      s.rangeEnd < end,
  );
}
export function candidates(tasks: Task[], date: string, today: string) {
  const parents = new Set(
    tasks.filter((t) => !t.archived && !t.completed).map((t) => t.parentId),
  );
  return tasks
    .filter(
      (t) =>
        !t.archived &&
        !t.completed &&
        t.kind === "task" &&
        !parents.has(t.id) &&
        (!t.scheduledDate || t.scheduledDate <= date) &&
        !(date < today),
    )
    .sort(
      (a, b) =>
        Number(b.scheduledDate === date) - Number(a.scheduledDate === date) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
}
export function planningBasis(
  tasks: Task[],
  sources: CalendarSnapshot[],
  settings: PlanningSettings,
  date: string,
) {
  // No refresh timestamps: an unchanged feed must not churn daily drafts.
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          date,
          settings: planningSettingsSchema.parse(settings),
          tasks: tasks
            .filter((t) => !t.archived && !t.completed)
            .map((t) => [
              t.id,
              t.title,
              t.notes,
              t.doneWhen,
              t.minutes,
              t.parentId,
              t.kind,
              t.today,
              t.scheduledDate,
              t.position,
              t.plannedStart,
              t.plannedEnd,
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          sources: sources
            .map((s) => [
              s.id,
              s.error,
              s.timeZone ?? null,
              s.events
                .map((e) => [
                  e.id,
                  e.title,
                  e.start,
                  e.end,
                  e.allDay,
                  e.busy,
                  e.startDate ?? null,
                  e.endDate ?? null,
                ])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        }),
      ),
    ),
  );
}
export function availability(
  date: string,
  settings: PlanningSettings,
  sources: CalendarSnapshot[],
  now = 0,
) {
  if (!settings.workDays.includes(Temporal.PlainDate.from(date).dayOfWeek))
    return { windows: [] as { start: number; end: number }[], minutes: 0 };
  const start = Math.max(
      atTime(date, settings.workStart, settings.timeZone),
      now,
    ),
    end = atTime(date, settings.workEnd, settings.timeZone);
  const busy = calendarEventsForDay(sources, date, settings.timeZone)
    .filter((e) => e.busy && (!e.allDay || settings.allDayBusy))
    .map((e) =>
      e.allDay
        ? { start, end }
        : {
            start: e.start - settings.bufferMinutes * 60000,
            end: e.end + settings.bufferMinutes * 60000,
          },
    )
    .sort((a, b) => a.start - b.start);
  const windows: { start: number; end: number }[] = [];
  let cursor = start;
  for (const event of busy) {
    if (event.end <= cursor || event.start >= end) continue;
    if (event.start > cursor)
      windows.push({ start: cursor, end: Math.min(end, event.start) });
    cursor = Math.max(cursor, event.end);
  }
  if (cursor < end) windows.push({ start: cursor, end });
  return {
    windows,
    minutes: Math.max(
      0,
      Math.floor(windows.reduce((n, w) => n + (w.end - w.start) / 60000, 0)) -
        settings.reserveMinutes,
    ),
  };
}
export function fitPlan(
  tasks: Task[],
  ranked: { taskId: string; reason: string }[],
  date: string,
  settings: PlanningSettings,
  sources: CalendarSnapshot[],
  now: number,
) {
  const { windows, minutes } = availability(date, settings, sources, now);
  let slots = windows.map((w) => ({ ...w }));
  let remaining = minutes;
  const blocks: PlanBlock[] = [];
  const byId = new Map(
    candidates(tasks, date, zonedDate(now, settings.timeZone)).map((t) => [
      t.id,
      t,
    ]),
  );
  const seen = new Set<string>();
  // Retain approved slots that still fit. New suggestions use the remaining gaps.
  for (const task of byId.values()) {
    const start = task.plannedStart,
      end = task.plannedEnd;
    if (
      task.scheduledDate !== date ||
      !start ||
      !end ||
      task.minutes > remaining ||
      end - start !== task.minutes * 60000
    )
      continue;
    if (!slots.some((w) => start >= w.start && end <= w.end)) continue;
    blocks.push({
      taskId: task.id,
      start,
      end,
      reason: "Keep your approved time.",
    });
    seen.add(task.id);
    remaining -= task.minutes;
    slots = slots.flatMap((w) =>
      end <= w.start || start >= w.end
        ? [w]
        : [
            { start: w.start, end: start },
            { start: end, end: w.end },
          ].filter((w) => w.end > w.start),
    );
  }
  for (const item of ranked) {
    const task = byId.get(item.taskId);
    if (!task || seen.has(task.id) || task.minutes > remaining) continue;
    seen.add(task.id);
    const slot = slots.find((w) => (w.end - w.start) / 60000 >= task.minutes);
    if (!slot) continue;
    blocks.push({
      taskId: task.id,
      start: slot.start,
      end: slot.start + task.minutes * 60000,
      reason: item.reason,
    });
    slot.start += task.minutes * 60000;
    remaining -= task.minutes;
  }
  return {
    blocks: blocks.sort((a, b) => a.start - b.start),
    availableMinutes: minutes,
  };
}
export function planApprovalIssue(
  plan: DailyPlan,
  selected: string[],
  tasks: Task[],
  sources: CalendarSnapshot[],
  settings: PlanningSettings,
  now: number,
  activeTaskId?: string,
) {
  if (plan.basis !== planningBasis(tasks, sources, settings, plan.date))
    return "Your tasks or calendar changed. Prepare a fresh plan.";
  if (calendarWarnings(sources, plan.date, settings, now).length)
    return "Refresh your calendars before approving.";
  const blocks = plan.blocks.filter((b) => selected.includes(b.taskId));
  if (blocks.some((b) => b.start < now))
    return "Some suggested times have passed. Prepare a fresh plan.";
  if (blocks.some((b) => b.taskId === activeTaskId))
    return "Pause or finish your current focus session before rescheduling that step.";
  const retained = tasks.filter(
    (t) =>
      !t.archived &&
      !t.completed &&
      !selected.includes(t.id) &&
      t.plannedStart &&
      t.plannedEnd,
  );
  if (
    blocks.some((b) =>
      retained.some((t) => b.start < t.plannedEnd! && b.end > t.plannedStart!),
    )
  )
    return "This selection overlaps another approved step. Include that step in the revision or prepare a fresh plan.";
  return null;
}
