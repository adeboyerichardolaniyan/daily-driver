import { test, expect } from "@playwright/test";
test("briefing sections preview edits and save offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await page.getByLabel("Heading", { exact: true }).fill("A small beginning");
  await page.getByRole("checkbox", { name: "Receipt QR code" }).uncheck();
  await page.getByLabel("Section type").click();
  await page.getByRole("option", { name: "Custom text", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  const section = page.locator(".briefing-section").last();
  await section.getByLabel("Section heading").fill("Remember");
  await section
    .getByLabel("Text", { exact: true })
    .fill("Just open the portfolio file.");
  await page
    .getByRole("button", { name: "Move Remember up", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Receipt preview"]')
      .getByText("Just open the portfolio file."),
  ).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".briefing-editor").getByRole("status")).toHaveText(
    "Template saved.",
  );
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await expect(page.getByLabel("Heading", { exact: true })).toHaveValue(
    "A small beginning",
  );
  await expect(
    page.getByRole("checkbox", { name: "Receipt QR code" }),
  ).not.toBeChecked();
  await expect(
    page.locator(".briefing-section").nth(2).getByLabel("Section heading"),
  ).toHaveValue("Remember");
  await page
    .getByRole("button", { name: "Remove Remember", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Remember", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
