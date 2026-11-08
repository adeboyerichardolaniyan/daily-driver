import { weatherKey } from "./weather";
import { dailyContent, type ContentEntry } from "./content-collections";
import { isToday } from "./calendar";
import type { Task, Workspace } from "./workspace";
import {
  calendarEventsForDay,
  zonedDate,
  availability,
  calendarWarnings,
} from "./planning";
import type { BriefingTemplate } from "./briefing";

import { receiptSchema, type ReceiptSnapshot } from "./receipt-schema";
export { receiptSchema, type ReceiptSnapshot } from "./receipt-schema";
export function createReceipt(tasks: Task[], baseUrl: string): ReceiptSnapshot {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.hostname === "localhost" ||
    base.hostname === "127.0.0.1"
  )
    throw new Error(
      "Set a public HTTPS app URL so your phone can open the task links.",
    );
  return receiptSchema.parse({
    version: 1,
    title: "One step at a time.",
    briefingUrl: new URL(
      `/?briefing=${new Date().toISOString().slice(0, 10)}`,
      base.origin,
    ).toString(),
    date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    tasks: tasks
      .filter(
        (task) =>
          isToday(task) &&
          !task.completed &&
          !task.archived &&
          task.kind === "task",
      )
      .map((task) => ({
        id: task.id,
        title: task.title,
        minutes: task.minutes,
        doneWhen: task.doneWhen,
        url: new URL(
          `/?task=${encodeURIComponent(task.id)}`,
          base.origin,
        ).toString(),
      })),
  });
}
function contentAttribution(entry: ContentEntry | null | undefined): string {
  if (!entry) return "";
  return entry.origin === "scripture-reflection"
    ? `Reflection on ${entry.attribution}`
    : [entry.attribution, entry.origin === "quotation" ? entry.translation : ""]
        .filter(Boolean)
        .join(" · ");
}
export function createBriefing(
  workspace: Workspace,
  template: BriefingTemplate,
  baseUrl: string,
  now = Date.now(),
): ReceiptSnapshot {
  const timeZone = workspace.planningSettings.timeZone;
  const date = zonedDate(now, timeZone);
  function pick(collectionId: string | undefined) {
    const collection = workspace.contentCollections.find(
      (c) => c.id === collectionId,
    );
    return collection
      ? (workspace.contentPicks[`${collection.id}:${date}`] ??
          dailyContent(collection, date, workspace.contentPicks))
      : null;
  }
  const titleEntry = pick(template.titleCollectionId),
    footerEntry = pick(template.footerCollectionId);
  const cachedWeather = template.weather
    ? workspace.weatherSnapshots[weatherKey(template.weather, timeZone)]
    : undefined;
  const tasks = workspace.tasks
    .filter(
      (task) =>
        task.kind === "task" &&
        !task.completed &&
        !task.archived &&
        (task.scheduledDate ? task.scheduledDate === date : task.today) &&
        !workspace.tasks.some(
          (child) =>
            child.parentId === task.id && !child.completed && !child.archived,
        ),
    )
    .sort((a, b) => a.position - b.position);
  const snapshot = createReceipt(
    tasks.map((task) => ({ ...task, today: true, scheduledDate: undefined })),
    baseUrl,
  );
  return receiptSchema.parse({
    ...snapshot,
    weather:
      cachedWeather?.date === date
        ? {
            ...cachedWeather,
            stale: now - cachedWeather.fetchedAt > 2 * 60 * 60 * 1000,
          }
        : undefined,
    overview: [
      {
        label: "Work window",
        value: workspace.planningSettings.workDays.includes(
          new Date(`${date}T12:00:00Z`).getUTCDay() || 7,
        )
          ? `${workspace.planningSettings.workStart}–${workspace.planningSettings.workEnd}`
          : "Non-working day",
      },
      {
        label: "Task estimates",
        value: `${tasks.reduce((sum, t) => sum + t.minutes, 0)} min`,
      },
      {
        label: "Task capacity",
        value: calendarWarnings(
          workspace.calendars,
          date,
          workspace.planningSettings,
          now,
        ).length
          ? "Calendar refresh needed"
          : `${availability(date, workspace.planningSettings, workspace.calendars).minutes} min after buffers`,
      },
      {
        label: "Reserved time",
        value: `${workspace.planningSettings.reserveMinutes} min`,
      },
    ],
    title: titleEntry?.text ?? template.title,
    titleAttribution: contentAttribution(titleEntry),
    closingLine: footerEntry?.text ?? template.footer,
    closingAttribution: contentAttribution(footerEntry),
    day: date,
    timeZone,
    briefingUrl: new URL(
      `/?briefing=${date}`,
      new URL(baseUrl).origin,
    ).toString(),
    content: template.sections
      .filter((s) => s.kind === "collection")
      .map((section) => {
        const collection = workspace.contentCollections.find(
          (c) => c.id === section.collectionId,
        );
        const entry = collection
          ? (workspace.contentPicks[`${collection.id}:${date}`] ??
            dailyContent(collection, date, workspace.contentPicks))
          : null;
        return {
          sectionId: section.id,
          text: entry?.text ?? "No approved entries yet.",
          attribution: contentAttribution(entry),
        };
      }),
    template,
    date: new Date(now).toLocaleDateString("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    tasks: template.sections.some((section) => section.kind === "tasks")
      ? snapshot.tasks.map((item) => {
          const task = tasks.find((task) => task.id === item.id)!;
          return {
            ...item,
            context: workspace.tasks.find(
              (parent) => parent.id === task.parentId,
            )?.title,
            scheduledTime: task.plannedStart
              ? new Date(task.plannedStart).toLocaleTimeString("en-US", {
                  timeZone,
                  hour: "numeric",
                  minute: "2-digit",
                })
              : undefined,
          };
        })
      : [],
    events: calendarEventsForDay(workspace.calendars, date, timeZone)
      .sort((a, b) => a.start - b.start)
      .map((event) => ({
        title: event.title,
        time: event.allDay
          ? "All day"
          : [event.start, event.end]
              .map((at) =>
                new Date(at).toLocaleTimeString("en-US", {
                  timeZone,
                  hour: "numeric",
                  minute: "2-digit",
                }),
              )
              .join("–"),
      })),
  });
}
