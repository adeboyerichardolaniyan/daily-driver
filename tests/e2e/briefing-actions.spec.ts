import { test, expect } from "@playwright/test";

test("briefing actions stay above the form and saved briefings open without losing edits", async ({
  page,
}) => {
  await page.goto("/?view=briefings");
  const collections = page.getByRole("button", { name: /Content collections/ });
  await collections.click();
  const collectionDialog = page.getByRole("dialog", {
    name: "Content collections",
  });
  await collectionDialog
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  await expect(
    collectionDialog.getByLabel("Name", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Save today’s briefing", exact: true })
    .click();
  const saved = page.getByRole("button", {
    name: "Open saved briefing",
    exact: true,
  });
  await expect(saved).toBeVisible();
  await page
    .getByLabel("Heading", { exact: true })
    .fill("Keep this unsaved heading");

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".workspace-body").evaluate((el) => el.scrollTo(0, 0));
    const form = await page
      .locator(".briefing-settings-group")
      .first()
      .boundingBox();
    for (const action of [collections, saved]) {
      const box = await action.boundingBox();
      expect(box!.y + box!.height + 16).toBeLessThanOrEqual(form!.y);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await expect(collections.locator(".collection-count")).toHaveText("1");
    await saved.click();
    const dialog = page.getByRole("dialog", {
      name: "Saved briefing",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((animation) => animation.finished),
      );
    });
    await expect(
      dialog.getByRole("heading", { name: "One step at a time.", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".briefing-editor")).toBeAttached();
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(width - 24);
    expect(bounds!.x).toBeGreaterThanOrEqual(12);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 12);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(saved).toBeFocused();
    await expect(page.getByLabel("Heading", { exact: true })).toHaveValue(
      "Keep this unsaved heading",
    );
  }
  await saved.click();
  await page
    .getByRole("dialog", { name: "Saved briefing", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(saved).toBeFocused();
});
