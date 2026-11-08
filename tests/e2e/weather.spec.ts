import { test, expect } from "@playwright/test";
test("weather location, units, offline cache and footer collections", async ({
  page,
  context,
}) => {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: 1,
            name: "New York",
            admin1: "New York",
            country: "United States",
            latitude: 40.7,
            longitude: -74,
          },
        ],
      },
    }),
  );
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({
      json: {
        current: { temperature_2m: 56, weather_code: 0 },
        daily: {
          time: [date],
          temperature_2m_max: [63],
          temperature_2m_min: [48],
          precipitation_probability_max: [10],
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await expect(
    page
      .locator(".briefing-page-footer")
      .getByRole("button", { name: /Content collections/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose a city to include its forecast on your receipt."),
  ).toBeVisible();
  await page.getByLabel("Weather city").fill("New York");
  await page.getByRole("button", { name: "Find city", exact: true }).click();
  await page
    .getByRole("button", {
      name: "New York, New York, United States",
      exact: true,
    })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Receipt preview"]')
      .getByText("Clear skies", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".briefing-editor").getByRole("status")).toHaveText(
    "Template saved.",
  );
  await page.reload();
  await page.getByRole("button", { name: "Briefings", exact: true }).click();
  await context.setOffline(true);
  await expect(
    page
      .frameLocator('iframe[title="Receipt preview"]')
      .getByText("Clear skies", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Weather units")).toHaveText("°F");
  await context.setOffline(false);
});
