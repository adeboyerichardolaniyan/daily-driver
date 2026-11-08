import { ChoiceSelect } from "./ui/choice-select";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Search } from "lucide-react";
import { fetchWeather, searchWeatherLocations } from "@/data/weather";
import {
  weatherKey,
  weatherDescription,
  type WeatherLocation,
  type WeatherSnapshot,
} from "@/domain/weather";
import { zonedDate } from "@/domain/planning";
import type { WorkspaceRepository } from "@/data/repository";
export function WeatherSettings({
  location,
  timeZone,
  cached,
  repository,
  onChange,
}: {
  location?: WeatherLocation;
  timeZone: string;
  cached?: WeatherSnapshot;
  repository: WorkspaceRepository;
  onChange: (value: WeatherLocation | undefined) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<
      Awaited<ReturnType<typeof searchWeatherLocations>>
    >([]),
    [searching, setSearching] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [searchError, setSearchError] = useState(""),
    [revision, setRevision] = useState(0);
  const searchController = useRef<AbortController | null>(null);
  const key = location ? weatherKey(location, timeZone) : "";
  useEffect(
    () => () => {
      searchController.current?.abort();
      searchController.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!location) return;
    let active = true,
      running = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (running) return;
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      setRefreshing(true);
      setError("");
      try {
        const snapshot = await fetchWeather(
          location!,
          timeZone,
          controller.signal,
        );
        if (active)
          await repository.append([{ type: "weather.snapshot", snapshot }]);
      } catch {
        if (active)
          setError("Weather could not refresh. Your last forecast is kept.");
      } finally {
        clearTimeout(timeout);
        running = false;
        if (active) setRefreshing(false);
      }
    }
    if (
      revision ||
      !cached ||
      cached.key !== key ||
      cached.date !== zonedDate(Date.now(), timeZone) ||
      Date.now() - cached.fetchedAt > 30 * 60000
    )
      void refresh();
    else setRefreshing(false);
    const timer = setInterval(() => void refresh(), 30 * 60000);
    const online = () => void refresh();
    window.addEventListener("online", online);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
    // The location key owns the network subscription; cache updates don't restart it.
  }, [key, timeZone, repository, revision]);
  async function search() {
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setSearching(true);
    setSearchError("");
    try {
      const matches = await searchWeatherLocations(query, controller.signal);
      setResults(matches);
      if (!matches.length)
        setSearchError("No locations found. Try a city and country.");
    } catch {
      if (searchController.current === controller)
        setSearchError("Location search is unavailable. Try again.");
    } finally {
      clearTimeout(timeout);
      if (searchController.current === controller) setSearching(false);
    }
  }
  return (
    <div className="weather-settings">
      <div className="weather-search">
        <Input
          aria-label="Weather city"
          placeholder="City or postal code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim().length >= 2) {
              e.preventDefault();
              void search();
            }
          }}
        />
        <Button
          variant="outline"
          disabled={searching || query.trim().length < 2}
          onClick={() => void search()}
        >
          <Search />
          {searching ? "Searching…" : "Find city"}
        </Button>
      </div>
      {searchError && <p role="alert">{searchError}</p>}
      {results.length > 0 && (
        <div className="weather-results">
          {results.map((result) => (
            <Button
              key={result.id}
              variant="ghost"
              onClick={() => {
                onChange({
                  name: result.name,
                  latitude: result.latitude,
                  longitude: result.longitude,
                  unit: location?.unit ?? "fahrenheit",
                });
                setResults([]);
                setQuery("");
              }}
            >
              {result.name}
            </Button>
          ))}
        </div>
      )}
      {location && (
        <>
          <div className="weather-location">
            <span>{location.name}</span>
            <ChoiceSelect
              aria-label="Weather units"
              value={location.unit}
              onChange={(e) =>
                onChange({
                  ...location,
                  unit: e.target.value as WeatherLocation["unit"],
                })
              }
            >
              <option value="fahrenheit">°F</option>
              <option value="celsius">°C</option>
            </ChoiceSelect>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh weather"
              disabled={refreshing}
              onClick={() => setRevision((n) => n + 1)}
            >
              <RefreshCw />
            </Button>
          </div>
          {cached?.key === key &&
            cached.date === zonedDate(Date.now(), timeZone) && (
              <p className="weather-current">
                <strong>
                  {Math.round(cached.temperature)}°
                  {location.unit === "fahrenheit" ? "F" : "C"}
                </strong>{" "}
                {weatherDescription(cached.code)}
              </p>
            )}
          <small>
            {refreshing
              ? "Updating forecast…"
              : cached?.key === key
                ? `Updated ${new Date(cached.fetchedAt).toLocaleString()} · ${cached.date}`
                : "Waiting for weather."}{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
          </small>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
