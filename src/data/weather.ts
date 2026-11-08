import { z } from "zod";
import { parseWeather, type WeatherLocation } from "../domain/weather";
const resultsSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        admin1: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .optional(),
});
export async function searchWeatherLocations(
  query: string,
  signal?: AbortSignal,
) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "6",
    language: "en",
  }).toString();
  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not search locations. Try again.");
  return (resultsSchema.parse(await response.json()).results ?? []).map(
    (item) => ({
      id: item.id,
      name: [item.name, item.admin1, item.country].filter(Boolean).join(", "),
      latitude: item.latitude,
      longitude: item.longitude,
    }),
  );
}
export async function fetchWeather(
  location: WeatherLocation,
  timeZone: string,
  signal?: AbortSignal,
) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: timeZone,
    temperature_unit: location.unit,
    current: "temperature_2m,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "1",
  }).toString();
  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Could not refresh weather. Cached data is retained.");
  return parseWeather(await response.json(), location, timeZone);
}
