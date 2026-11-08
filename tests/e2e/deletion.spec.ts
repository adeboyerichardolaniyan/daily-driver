import { test, expect } from "@playwright/test";
test("task deletion supports cancellation, editor access and persists after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Delete me");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Delete me" }).click();
  await page
    .getByRole("menuitem", { name: "Delete task", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Delete Delete me?");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete me", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete me", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete me", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete me", exact: true }),
  ).toHaveCount(0);
});
test("Manage data deletes an entire project including nested tasks", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Use portfolio example/ }).click();
  await page
    .getByRole("button", { name: "Settings & connections", exact: true })
    .click();
  const manager = page.getByRole("region", { name: "Manage data" });
  await manager
    .getByRole("button", { name: "Delete Get ready to apply", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "5 nested tasks or steps",
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    manager.getByText("No objects here.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Today", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", {
      name: "Actions for Open your first case study",
    }),
  ).toHaveCount(0);
});
