import { test, expect } from "@playwright/test";
test("collection preferences, approved rotation, and saved QR destination work offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await page.getByRole("button", { name: /Content collections/ }).click();
  const dialog = page.getByRole("dialog", { name: "Content collections" });
  await dialog
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  await dialog.getByLabel("Name", { exact: true }).fill("Daily scripture");
  await dialog.getByLabel("Content type", { exact: true }).click();
  await page
    .getByRole("option", { name: "Bible passages & reflections", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Bible translation", { exact: true }),
  ).toHaveValue("EasyEnglish (EASY)");
  await dialog.getByLabel("Tone", { exact: true }).fill("Reflective and calm");
  await dialog
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Add entry", exact: true }).click();
  const entry = dialog.locator(".collection-entry").first();
  await entry.locator("textarea").fill("Take a quiet moment before beginning.");
  await entry
    .getByRole("button", { name: "Approve entry", exact: true })
    .click();
  await expect(dialog.locator(".collection-today")).toContainText(
    "Take a quiet moment before beginning.",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Section type").click();
  await page
    .getByRole("option", { name: "Rotating content", exact: true })
    .click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page
    .locator(".briefing-section")
    .last()
    .getByLabel("Collection", { exact: true })
    .click();
  await page
    .getByRole("option", { name: "Daily scripture · 1 approved", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Receipt preview"]')
      .getByText("Take a quiet moment before beginning."),
  ).toBeVisible();
  await page.getByLabel("Heading source", { exact: true }).click();
  await page
    .getByRole("option", { name: "Daily scripture", exact: true })
    .click();
  await page.getByLabel("Closing line source", { exact: true }).click();
  await page
    .getByRole("option", { name: "Daily scripture", exact: true })
    .click();
  await expect(
    page.frameLocator('iframe[title="Receipt preview"]').locator("h1"),
  ).toHaveText("Take a quiet moment before beginning.");
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".briefing-editor").getByRole("status")).toHaveText(
    "Template saved.",
  );
  await page
    .getByRole("button", { name: "Save today’s briefing", exact: true })
    .click();
  await expect(
    page.locator(".briefing-editor").getByRole("status"),
  ).toContainText("Today’s briefing saved");
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await expect(page.getByLabel("Heading source")).toHaveText("Daily scripture");
  await page
    .getByRole("button", { name: "Open saved briefing", exact: true })
    .click();
  await expect(page.locator(".saved-briefing")).toContainText(
    "Take a quiet moment before beginning.",
  );
  // The receipt QR uses this same date route and keeps the saved content.
  const day = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await page.goto(`/?briefing=${day}`);
  await expect(page.locator(".saved-briefing")).toContainText(
    "Take a quiet moment before beginning.",
  );
  await page
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();
  await page.getByRole("button", { name: /Content collections/ }).click();
  await dialog.getByLabel("Collection", { exact: true }).click();
  await page
    .getByRole("option", { name: "Daily scripture", exact: true })
    .click();
  await expect(dialog.getByLabel("Tone", { exact: true })).toHaveValue(
    "Reflective and calm",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => dialog.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
