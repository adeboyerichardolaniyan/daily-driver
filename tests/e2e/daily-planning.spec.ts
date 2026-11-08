import { test, expect } from "@playwright/test";

test("working hours and evening planning time are editable and persist offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Settings & connections", exact: true })
    .click();
  await page.getByLabel("Work starts", { exact: true }).fill("10:00");
  await page.getByLabel("Work ends", { exact: true }).fill("18:00");
  await page.getByLabel("Prepare tomorrow at", { exact: true }).fill("20:30");
  await page.getByLabel("Timezone", { exact: true }).fill("Europe/London");
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Save planning preferences", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Planning preferences saved.",
  );
  await context.setOffline(false);
  await page.reload();
  await page
    .getByRole("button", { name: "Settings & connections", exact: true })
    .click();
  await expect(page.getByLabel("Work starts", { exact: true })).toHaveValue(
    "10:00",
  );
  await expect(
    page.getByLabel("Prepare tomorrow at", { exact: true }),
  ).toHaveValue("20:30");
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(
    "Europe/London",
  );
});

test("daily review shows imported events and only schedules selected steps after approval", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.TEST_PRODUCTION),
    "Seeds an isolated local draft using Vite modules.",
  );
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const paths = [
      "/src/data/database.ts",
      "/src/data/repository.ts",
      "/src/domain/planning.ts",
      "/src/domain/workspace.ts",
    ];
    const [{ db }, { WorkspaceRepository }, planning, domain] =
      await Promise.all(paths.map((p) => import(p)));
    const repository = new WorkspaceRepository(db),
      now = Date.now(),
      settings = {
        ...planning.defaultPlanningSettings("America/New_York"),
        workDays: [1, 2, 3, 4, 5, 6, 7],
      };
    const date = planning.nextDate(planning.zonedDate(now, settings.timeZone));
    const at = (time: string) => planning.atTime(date, time, settings.timeZone);
    const tasks = [
      {
        id: crypto.randomUUID(),
        ...domain.taskDefaults("Update case study", {
          today: false,
          minutes: 20,
        }),
      },
      {
        id: crypto.randomUUID(),
        ...domain.taskDefaults("Ask for feedback", {
          today: false,
          minutes: 10,
        }),
      },
    ];
    const source = {
      id: "fixture",
      name: "Personal",
      refreshedAt: now,
      error: null,
      rangeStart: now - 86400000,
      rangeEnd: now + 7 * 86400000,
      events: [
        {
          id: "meeting",
          title: "Design review call",
          start: at("11:00"),
          end: at("12:00"),
          busy: true,
          allDay: false,
        },
      ],
    };
    const plan = {
      id: crypto.randomUUID(),
      date,
      basis: planning.planningBasis(tasks, [source], settings, date),
      createdAt: now,
      status: "ready",
      blocks: [
        {
          taskId: tasks[0].id,
          start: at("09:00"),
          end: at("09:20"),
          reason: "Make progress before your call.",
        },
        {
          taskId: tasks[1].id,
          start: at("09:20"),
          end: at("09:30"),
          reason: "Get a second opinion.",
        },
      ],
      availableMinutes: 340,
      message: "A short morning plan.",
    };
    await repository.append([
      { type: "planning.settings", settings },
      ...tasks.map((task) => ({
        type: "task.create",
        taskId: task.id,
        fields: task,
      })),
      { type: "calendar.snapshot", source },
      { type: "planning.result", plan },
    ]);
  });
  const planning = page.getByRole("region", { name: "Daily planning" });
  await planning.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await planning
    .getByRole("button", { name: "Review plan", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tomorrow’s plan" });
  await dialog.getByRole("checkbox").nth(1).uncheck();
  await dialog
    .getByRole("button", { name: "Approve 1 step", exact: true })
    .click();
  await expect(dialog.getByText("Approved.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ask for feedback", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update case study", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Today/ })
    .first()
    .click();
  await page
    .getByRole("group", { name: "Today view" })
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await expect(
    page.getByText("Design review call", { exact: true }),
  ).toBeVisible();
});
