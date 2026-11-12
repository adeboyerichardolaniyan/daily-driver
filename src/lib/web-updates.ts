import { isTauri } from "@tauri-apps/api/core";
import { registerSW } from "virtual:pwa-register";

let updateReady = false;
const listeners = new Set<() => void>();

export const webUpdates = {
  snapshot: () => updateReady,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

// The worker activates immediately so older tabs can escape the legacy cache.
// Reloading the UI stays explicit, preserving any edits in an open form.
export function startWebUpdates() {
  if (!import.meta.env.PROD || isTauri() || !("serviceWorker" in navigator)) {
    return () => {};
  }
  let active = true;
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  async function check() {
    if (
      !registration ||
      checking ||
      !navigator.onLine ||
      document.visibilityState !== "visible"
    )
      return;
    checking = true;
    try {
      await registration.update();
    } catch {
      // Offline and transient update failures leave the cached workspace usable.
    } finally {
      checking = false;
    }
  }
  registerSW({
    immediate: true,
    onNeedReload() {
      if (!active) return;
      updateReady = true;
      listeners.forEach((listener) => listener());
    },
    onRegisteredSW(_url, value) {
      if (active) registration = value;
    },
  });
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  const interval = window.setInterval(check, 5 * 60 * 1000);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("online", check);
    window.clearInterval(interval);
  };
}
