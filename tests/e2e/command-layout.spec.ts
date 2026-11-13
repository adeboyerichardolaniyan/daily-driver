import { test, expect } from "@playwright/test";

// Run against the minified release too: development CSS hid this regression.
test("command palette keeps its input and results inside the window", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  const palette = page.getByRole("dialog", { name: "Search workspace" });
  const input = palette.getByRole("combobox");
  const trigger = page.getByRole("button", {
    name: "Search tasks",
    exact: true,
  });

  for (const viewport of [
    { width: 2000, height: 1125 },
    { width: 1320, height: 880 },
    { width: 800, height: 540 },
    { width: 380, height: 540 },
  ]) {
    await page.setViewportSize(viewport);
    await page.keyboard.press("Meta+k");
    await expect(input).toBeFocused();
    await palette.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((animation) => animation.finished),
      );
    });
    const bounds = await palette.boundingBox();
    expect(
      bounds!.y,
      "Palette must not be clipped above the window",
    ).toBeGreaterThanOrEqual(16);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      viewport.height - 16,
    );
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(
      Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2),
      "Palette must be horizontally centered",
    ).toBeLessThan(1);
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(
      palette.getByText("Esc Close", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await input.fill("zzzznonexistent");
    await expect(palette.getByText("No results found.")).toBeVisible();
    const filtered = await input.boundingBox();
    expect(filtered!.y).toBeGreaterThanOrEqual(16);
    expect(filtered!.y).toBeLessThan(bounds!.y + 48);
    await page.keyboard.press("Escape");
    await expect(palette).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
