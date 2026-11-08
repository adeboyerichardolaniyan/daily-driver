import { describe, expect, it } from "vitest";
import {
  dateFromKey,
  dateKey,
  monthDays,
  scheduledDay,
  shiftDate,
  isToday,
} from "../src/domain/calendar";
import { actionSchema, taskDefaults, type Task } from "../src/domain/workspace";

const task = (extra: Partial<Task> = {}): Task => ({
  ...taskDefaults("Write case study"),
  id: "example",
  ...extra,
});

describe("calendar scheduling", () => {
  it("reads older tasks and gives explicit dates precedence over the legacy today flag", () => {
    expect(scheduledDay(task(), "2026-11-07")).toBe("2026-11-07");
    expect(scheduledDay(task({ today: false }), "2026-11-07")).toBeNull();
    expect(isToday(task({ scheduledDate: "2026-11-08" }), "2026-11-07")).toBe(
      false,
    );
    expect(
      isToday(
        task({ scheduledDate: "2026-11-07", today: false }),
        "2026-11-07",
      ),
    ).toBe(true);
  });
  it("keeps dates local across DST and year boundaries", () => {
    expect(dateKey(dateFromKey("2026-11-01"))).toBe("2026-11-01");
    expect(shiftDate("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("builds a Monday-first six-week month including adjacent dates", () => {
    const days = monthDays("2026-11-01");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26");
    expect(days).toContain("2026-11-30");
  });
  it("preserves scheduling in sync events and rejects impossible dates", () => {
    const event = {
      type: "task.edit",
      taskId: "00000000-0000-4000-8000-000000000000",
      fields: { scheduledDate: "2026-11-08" },
    };
    expect(actionSchema.parse(event)).toEqual(event);
    expect(
      actionSchema.safeParse({
        ...event,
        fields: { scheduledDate: "2026-02-30" },
      }).success,
    ).toBe(false);
    expect(
      actionSchema.parse({ ...event, fields: { title: "Edited" } }),
    ).toEqual({ ...event, fields: { title: "Edited" } });
  });
});
