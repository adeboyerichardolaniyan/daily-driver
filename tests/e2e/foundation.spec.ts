import { test, expect } from "@playwright/test";

test("local tasks persist offline and focus stays shared across windows", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start this step" }).click();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/?view=focus");
  await expect(
    second.getByRole("heading", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Pause timer" }).click();
  await expect(
    page.getByRole("button", { name: "Resume timer" }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "Complete step", exact: true })
    .click();
  await expect(page.getByText("1 of 4 complete")).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "New task", exact: false })
    .first()
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Draft portfolio introduction");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Draft portfolio introduction",
      exact: true,
    }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Draft portfolio introduction",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("1 of 5 complete")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile capture and hierarchy editing remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open your first case study", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Open the updated portfolio draft");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Open the updated portfolio draft",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("production app opens and edits after a fully offline reload", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.TEST_PRODUCTION,
    "Requires the production service worker.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await expect(
    page.getByText("Portfolio example added.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start this step" }).click();
  await page
    .getByRole("button", { name: "Complete step", exact: true })
    .click();
  await expect(page.getByText("1 of 4 complete")).toBeVisible();
  await context.setOffline(false);
});

test("task QR links open the intended task even during another focus session", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await expect(
    page.getByText("Portfolio example added.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start this step" }).click();
  await page.getByRole("button", { name: "Settings & connections" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export task history" }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  const target = exported.events
    .map((event: { payload: string }) => JSON.parse(event.payload))
    .find(
      (event: { fields?: { title: string } }) =>
        event.fields?.title === "Write down what needs updating",
    );
  await page.goto(`/?task=${target.taskId}`);
  const linked = page.getByRole("region", { name: "Opened task" });
  await expect(
    linked.getByRole("heading", { name: "Write down what needs updating" }),
  ).toBeVisible();
  await linked.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByText("1 of 4 complete")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
});

test("assistant contains keyboard focus and restores its trigger", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Assistant", exact: true });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Your copilot" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(
    sheet.getByRole("button", { name: "Create a separate task", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    sheet.getByRole("button", { name: "Close assistant" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await sheet
    .getByRole("button", { name: "Create a separate task", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
});

test("narrow screens preserve readable forms and touch controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  const focus = page.getByRole("region", { name: "Current focus" });
  for (const control of await focus.getByRole("button").all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.getByLabel("Title", { exact: true });
  expect(
    await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await input.fill("A long task title ".repeat(15));
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("calendar schedules tasks, keeps them out of Today, and persists changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const columns = page.getByRole("region", { name: "Daily task columns" });
  await expect(
    columns.getByRole("button", {
      name: "Open your first case study",
      exact: true,
    }),
  ).toBeVisible();
  await columns
    .getByRole("button", { name: "Add task", exact: true })
    .nth(1)
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Tomorrow’s portfolio review");
  const scheduled = await page.getByLabel("Scheduled date").inputValue();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    columns.getByRole("button", {
      name: "Tomorrow’s portfolio review",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Tomorrow’s portfolio review",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await columns
    .getByRole("button", { name: "Tomorrow’s portfolio review", exact: true })
    .click();
  await expect(page.getByLabel("Scheduled date")).toHaveValue(scheduled);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await columns
    .getByRole("button", {
      name: "Complete Tomorrow’s portfolio review",
      exact: true,
    })
    .click();
  await expect(
    columns.getByRole("button", {
      name: "Reopen Tomorrow’s portfolio review",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("AI requests persist offline without creating unapproved tasks", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await context.setOffline(true);
  await page
    .getByLabel("What do you want to get done?")
    .fill("Prepare portfolio for job applications");
  await page.getByRole("button", { name: "Draft a plan", exact: true }).click();
  await expect(
    page.getByRole("region", {
      name: "Draft: Prepare portfolio for job applications",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await expect(
    page.getByRole("heading", { name: "No steps scheduled" }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const draft = page.getByRole("region", {
    name: "Draft: Prepare portfolio for job applications",
  });
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: "Discard" }).click();
  await expect(draft).not.toBeVisible();
});

test("Today scrolls content while keeping the app frame and view switch fixed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  for (const viewport of [{ width: 1440, height: 640 }, { width: 390, height: 600 }]) {
    await page.setViewportSize(viewport);
    for (const view of ["List", "Calendar"]) {
      const switcher = page.getByRole("group", { name: "Today view" });
      await switcher.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator(".app-shell")).toHaveCount(1);
      await expect(switcher).toBeInViewport();
      await page.locator(".workspace-body").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.evaluate(() => window.scrollTo(0, 10000));
      await expect(switcher).toBeInViewport();
      await expect(page.locator(".topbar")).toBeInViewport();
      expect(await page.evaluate(() => ({
        scroll: window.scrollY,
        fits: document.documentElement.scrollHeight <= innerHeight,
      }))).toEqual({ scroll: 0, fits: true });
    }
  }
});

test("command search works across views offline with keyboard and focus restoration", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
  await context.setOffline(true);
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Search workspace" });
  const input = palette.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("Open your first case study");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Open your first case study");
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Search tasks", exact: true });
  await trigger.click();
  await expect(input).toHaveValue("");
  await input.fill("zzzznonexistent");
  await expect(palette.getByText("No results found.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(palette).toBeInViewport();
  expect(await input.evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");
  await page.keyboard.press("Escape");
  await expect(page.locator(".search-bar")).toHaveCount(0);
});

test("manual steps join the current list and can be inserted after a sibling", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page.getByRole("heading", { name: "Open your first case study", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add a small step", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Belongs to" })).toContainText("Update portfolio case studies");
  await page.getByLabel("Title", { exact: true }).fill("Collect the original screenshots");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Open your first case study", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add step after", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Belongs to" })).toContainText("Update portfolio case studies");
  await page.getByLabel("Title", { exact: true }).fill("Ask a peer for feedback");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.locator('.task-label > span').nth(1)).toHaveText("Ask a peer for feedback");
  await page.reload();
  await expect(page.locator('.task-label > span').nth(1)).toHaveText("Ask a peer for feedback");
});
