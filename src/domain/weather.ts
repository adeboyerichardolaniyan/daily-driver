import { z } from "zod";
export const weatherLocationSchema = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  unit: z.enum(["celsius", "fahrenheit"]),
});
export type WeatherLocation = z.infer<typeof weatherLocationSchema>;
export const weatherSnapshotSchema = z.object({
  key: z.string().max(300),
  date: z.iso.date(),
  location: weatherLocationSchema,
  timeZone: z.string().max(100),
  fetchedAt: z.number().finite(),
  temperature: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  rain: z.number().min(0).max(100).nullable(),
  code: z.number().int(),
});
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;
export const weatherKey = (location: WeatherLocation, timeZone: string) =>
  `${location.latitude}:${location.longitude}:${location.unit}:${timeZone}`;
export function weatherDescription(code: number): string {
  if (code === 0) return "Clear skies";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Weather conditions";
}
export const weatherResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    weather_code: z.number().int(),
  }),
  daily: z.object({
    time: z.array(z.iso.date()).min(1),
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number().nullable()).min(1),
  }),
});
export function parseWeather(
  input: unknown,
  location: WeatherLocation,
  timeZone: string,
  now = Date.now(),
): WeatherSnapshot {
  const data = weatherResponseSchema.parse(input);
  return weatherSnapshotSchema.parse({
    key: weatherKey(location, timeZone),
    date: data.daily.time[0],
    location,
    timeZone,
    fetchedAt: now,
    temperature: data.current.temperature_2m,
    code: data.current.weather_code,
    high: data.daily.temperature_2m_max[0],
    low: data.daily.temperature_2m_min[0],
    rain: data.daily.precipitation_probability_max[0],
  });
}
