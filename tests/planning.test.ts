import { describe, it, expect } from "vitest";
import {
  defaultPlanningSettings,
  availability,
  fitPlan,
  atTime,
  planningBasis,
  planApprovalIssue,
  type CalendarSnapshot,
  type DailyPlan,
} from "../src/domain/planning";
import {
  projectWorkspace,
  taskDefaults,
  type Action,
} from "../src/domain/workspace";
import { parseCalendar } from "../convex/ical";
import { calendarFeedUrl } from "../src/domain/feed-url";
const date = "2026-11-09",
  zone = "America/New_York";
const settings = {
  ...defaultPlanningSettings(zone),
  bufferMinutes: 10,
  reserveMinutes: 60,
};
const time = (s: string) => atTime(date, s, zone);
const source: CalendarSnapshot = {
  id: "calendar",
  name: "Work",
  events: [
    {
      id: "meeting",
      title: "Review",
      start: time("10:00"),
      end: time("11:00"),
      allDay: false,
      busy: true,
    },
    {
      id: "overlap",
      title: "Call",
      start: time("10:30"),
      end: time("11:30"),
      allDay: false,
      busy: true,
    },
  ],
  refreshedAt: time("08:00"),
  error: null,
  rangeStart: time("00:00"),
  rangeEnd: time("23:59") + 60000,
};
const task = {
  id: crypto.randomUUID(),
  ...taskDefaults("Update portfolio", { minutes: 30 }),
};
function events(actions: Action[]) {
  return actions.map((action, index) => ({
    id: String(index),
    actor_id: "test",
    clock: index + 1,
    created_at: new Date(time("08:00")).toISOString(),
    payload: JSON.stringify(action),
  }));
}
describe("calendar-aware planning", () => {
  it("merges busy overlaps, applies buffers and reserves breathing room", () => {
    const result = availability(date, settings, [source]);
    expect(result.minutes).toBe(310);
    expect(result.windows).toEqual([
      { start: time("09:00"), end: time("09:50") },
      { start: time("11:40"), end: time("17:00") },
    ]);
  });
  it("handles DST using the configured timezone", () => {
    expect(
      atTime("2026-11-01", "12:00", zone) - atTime("2026-10-31", "12:00", zone),
    ).toBe(25 * 3600000);
    expect(
      atTime("2026-03-08", "12:00", zone) - atTime("2026-03-07", "12:00", zone),
    ).toBe(23 * 3600000);
  });
  it("blocks all-day events with exclusive end dates, but ignores free events", () => {
    const allDay = {
      ...source,
      events: [
        {
          id: "holiday",
          title: "Away",
          start: 0,
          end: 1,
          allDay: true,
          busy: true,
          startDate: date,
          endDate: "2026-11-10",
        },
      ],
    };
    expect(availability(date, settings, [allDay]).minutes).toBe(0);
    expect(availability("2026-11-10", settings, [allDay]).minutes).toBe(420);
    expect(
      availability(date, { ...settings, allDayBusy: false }, [allDay]).minutes,
    ).toBe(420);
  });
  it("never invents tasks, duplicates blocks, or changes valid approved slots", () => {
    const pinned = {
      ...task,
      scheduledDate: date,
      plannedStart: time("13:00"),
      plannedEnd: time("13:30"),
    };
    const other = { ...task, id: crypto.randomUUID(), minutes: 60 };
    const result = fitPlan(
      [pinned, other],
      [
        { taskId: other.id, reason: "Next" },
        { taskId: other.id, reason: "Duplicate" },
        { taskId: "invented", reason: "No" },
      ],
      date,
      settings,
      [source],
      time("08:00"),
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.find((b) => b.taskId === pinned.id)?.start).toBe(
      time("13:00"),
    );
  });
  it("requires approval and rejects stale inputs without moving tasks", () => {
    const plan: DailyPlan = {
      id: crypto.randomUUID(),
      date,
      basis: planningBasis([task], [], settings, date),
      createdAt: time("08:00"),
      status: "ready",
      blocks: [
        {
          taskId: task.id,
          start: time("09:00"),
          end: time("09:30"),
          reason: "Small next step",
        },
      ],
      availableMinutes: 420,
      message: "Suggested",
    };
    const base: Action[] = [
      { type: "task.create", taskId: task.id, fields: task },
      { type: "planning.settings", settings },
      { type: "planning.result", plan },
    ];
    expect(
      projectWorkspace(events(base)).tasks[0].scheduledDate,
    ).toBeUndefined();
    const approved = projectWorkspace(
      events([
        ...base,
        { type: "planning.approve", planId: plan.id, taskIds: [task.id] },
      ]),
    );
    expect(approved.tasks[0].scheduledDate).toBe(date);
    expect(approved.tasks[0].plannedStart).toBe(time("09:00"));
    const stale = projectWorkspace(
      events([
        ...base,
        { type: "task.edit", taskId: task.id, fields: { minutes: 60 } },
        { type: "planning.approve", planId: plan.id, taskIds: [task.id] },
      ]),
    );
    expect(stale.tasks[0].scheduledDate).toBeUndefined();
    expect(
      planApprovalIssue(plan, [task.id], [task], [], settings, time("10:00")),
    ).toContain("passed");
  });
  it("restricts feeds to provider HTTPS hosts and never accepts local URLs", () => {
    for (const url of [
      "http://calendar.google.com/a.ics",
      "https://localhost/a",
      "https://outlook.live.com.evil.test/a",
      "https://127.0.0.1/a",
      "https://user:password@calendar.google.com/a",
    ])
      expect(() => calendarFeedUrl(url)).toThrow();
    expect(calendarFeedUrl("webcal://calendar.google.com/a.ics")).toBe(
      "https://calendar.google.com/a.ics",
    );
  });
});
const feed = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
it("expands recurring events across DST with exceptions, moved occurrences, and cancellations", () => {
  const text = feed(
    `BEGIN:VEVENT\r\nUID:daily\r\nDTSTART;TZID=America/New_York:20261031T090000\r\nDTEND;TZID=America/New_York:20261031T100000\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE;TZID=America/New_York:20261101T090000\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:daily\r\nRECURRENCE-ID;TZID=America/New_York:20261102T090000\r\nDTSTART;TZID=America/New_York:20261102T110000\r\nDTEND;TZID=America/New_York:20261102T120000\r\nSUMMARY:Moved standup\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancel\r\nDTSTART:20261102T160000Z\r\nDTEND:20261102T170000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Canceled\r\nEND:VEVENT`,
  );
  const result = parseCalendar(
    text,
    Date.parse("2026-10-30"),
    Date.parse("2026-11-05"),
    zone,
  );
  expect(result).toHaveLength(3);
  expect(result.map((e) => new Date(e.start).toISOString())).toEqual([
    "2026-10-31T13:00:00.000Z",
    "2026-11-02T16:00:00.000Z",
    "2026-11-03T14:00:00.000Z",
  ]);
});
it("imports floating times and all-day exclusive end dates", () => {
  const text = feed(
    `BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261109T090000\r\nDTEND:20261109T100000\r\nSUMMARY:Local\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261111\r\nSUMMARY:Away\r\nEND:VEVENT`,
  );
  const result = parseCalendar(
    text,
    Date.parse("2026-11-08"),
    Date.parse("2026-11-12"),
    zone,
  );
  expect(result.find((e) => e.title === "Local")?.start).toBe(time("09:00"));
  expect(result.find((e) => e.title === "Away")).toMatchObject({
    allDay: true,
    startDate: date,
    endDate: "2026-11-11",
  });
});

it("deleting a calendar or saved approved plan preserves the approved task schedule", () => {
  const plan: DailyPlan = {
    id: crypto.randomUUID(),
    date,
    basis: planningBasis([task], [source], settings, date),
    createdAt: time("08:00"),
    status: "ready",
    blocks: [
      {
        taskId: task.id,
        start: time("09:00"),
        end: time("09:30"),
        reason: "Next step",
      },
    ],
    availableMinutes: 420,
    message: "Plan",
  };
  const base: Action[] = [
    { type: "task.create", taskId: task.id, fields: task },
    { type: "planning.settings", settings },
    { type: "calendar.snapshot", source },
    { type: "planning.result", plan },
    { type: "planning.approve", planId: plan.id, taskIds: [task.id] },
  ];
  const state = projectWorkspace(
    events([
      ...base,
      { type: "calendar.remove", sourceId: source.id },
      { type: "calendar.snapshot", source },
      { type: "object.delete", kind: "plan", id: plan.id },
    ]),
  );
  expect(state.tasks[0].plannedStart).toBe(time("09:00"));
  expect(state.calendars).toHaveLength(0);
  expect(state.dailyPlans).toHaveLength(0);
});
