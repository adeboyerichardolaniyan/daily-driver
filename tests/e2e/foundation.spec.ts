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
    page.getByRole("heading", { name: "The bigger picture." }),
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
