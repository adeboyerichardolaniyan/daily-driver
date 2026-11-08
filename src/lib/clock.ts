import { dateKey } from "@/domain/calendar";
import { useSyncExternalStore } from "react";
let now = Date.now();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval)
    interval = setInterval(() => {
      now = Date.now();
      listeners.forEach((fn) => fn());
    }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(interval);
      interval = undefined;
    }
  };
}
export function useClock() {
  return useSyncExternalStore(subscribe, () => now);
}
export function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function useLocalDay() {
  return useSyncExternalStore(subscribe, () => dateKey(new Date(now)));
}
