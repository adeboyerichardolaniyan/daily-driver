import { test, expect } from "@playwright/test";
test("daily delivery controls default to PDF and fit narrow screens", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await expect(page.getByLabel("Briefing output")).toHaveText("PDF only");
  await expect(
    page.getByRole("heading", { name: "Receipt template", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Prepare automatically").check();
  expect(
    await page
      .locator(".briefing-schedule-toggle")
      .evaluate((el) => getComputedStyle(el).display),
  ).toBe("flex");
  await page.getByLabel("Briefing time").fill("08:30");
  await expect(page.getByLabel("Briefing time")).toHaveValue("08:30");
  await page.getByLabel("Briefing output").click();
  await page
    .getByRole("option", { name: "Receipt printer", exact: true })
    .click();
  await expect(
    page.getByText(
      "Requires a configured printer and a worker running in printer mode.",
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Briefing output").scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".briefing-schedule")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
