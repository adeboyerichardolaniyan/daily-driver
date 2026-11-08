import { expect, it } from "vitest";
import {
  parseWeather,
  weatherKey,
  weatherDescription,
} from "../src/domain/weather";
import { projectWorkspace } from "../src/domain/workspace";
import { createBriefing, renderReceipt } from "../src/domain/receipt";
import { defaultBriefingTemplate } from "../src/domain/briefing";
const location = {
  name: "New York",
  latitude: 40.7,
  longitude: -74,
  unit: "fahrenheit" as const,
};
const payload = {
  current: { temperature_2m: 56, weather_code: 0 },
  daily: {
    time: ["2026-11-07"],
    temperature_2m_max: [63],
    temperature_2m_min: [48],
    precipitation_probability_max: [10],
  },
};
it("validates provider data and identifies units and timezone in cache keys", () => {
  const snapshot = parseWeather(payload, location, "America/New_York", 1);
  expect(snapshot).toMatchObject({
    temperature: 56,
    high: 63,
    low: 48,
    rain: 10,
    date: "2026-11-07",
  });
  expect(weatherKey(location, "UTC")).not.toBe(snapshot.key);
  expect(
    weatherKey({ ...location, unit: "celsius" }, "America/New_York"),
  ).not.toBe(snapshot.key);
  expect(() =>
    parseWeather(
      { ...payload, current: { temperature_2m: null, weather_code: 0 } },
      location,
      "UTC",
    ),
  ).toThrow();
  expect(weatherDescription(95)).toBe("Thunderstorms");
});
it("keeps newer synced forecasts and excludes old-day or mismatched weather from receipts", async () => {
  const now = Date.parse("2026-11-07T15:00:00Z"),
    snapshot = parseWeather(
      payload,
      location,
      "America/New_York",
      now - 3 * 3600000,
    );
  const state = projectWorkspace(
    [snapshot, { ...snapshot, temperature: 99, fetchedAt: 1 }].map(
      (snapshot, i) => ({
        id: crypto.randomUUID(),
        actor_id: "test",
        clock: i + 1,
        created_at: new Date(now).toISOString(),
        payload: JSON.stringify({ type: "weather.snapshot", snapshot }),
      }),
    ),
  );
  const template = {
    ...defaultBriefingTemplate(),
    weather: location,
    sections: [
      { id: "weather", kind: "weather" as const, title: "Weather", text: "" },
      {
        id: "overview",
        kind: "overview" as const,
        title: "Day overview",
        text: "",
      },
    ],
  };
  const receipt = createBriefing(state, template, "https://daily.example", now);
  expect(receipt.weather).toMatchObject({ temperature: 56, stale: true });
  const html = await renderReceipt(receipt);
  expect(html).toContain("Clear skies");
  expect(html).toContain("Open-Meteo");
  expect(html).toContain("Work window");
  expect(
    createBriefing(state, template, "https://daily.example", now + 86400000)
      .weather,
  ).toBeUndefined();
  expect(
    createBriefing(
      state,
      { ...template, weather: { ...location, unit: "celsius" } },
      "https://daily.example",
      now,
    ).weather,
  ).toBeUndefined();
});
