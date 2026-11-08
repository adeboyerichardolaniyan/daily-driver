import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { desktopUpdater } from "@/lib/desktop-updater";
import { version } from "../../package.json";

export function AppUpdates() {
  const state = useSyncExternalStore(
    desktopUpdater.subscribe,
    desktopUpdater.snapshot,
  );
  if (!isTauri()) return null;
  const busy = state.phase === "checking" || state.phase === "installing";
  return (
    <section className="settings-section" aria-label="App updates">
      <div className="section-heading">
        <RefreshCw />
        <h2>App updates</h2>
        <span className="subtle-badge">Version {version}</span>
      </div>
      <p role="status" aria-live="polite">
        {state.phase === "checking"
          ? "Checking for updates…"
          : state.phase === "available"
            ? `Version ${state.version} is available.`
            : state.phase === "installing"
              ? `Installing update${state.percent === undefined ? "…" : ` · ${state.percent}%`}`
              : state.message ||
                "Get the latest improvements without reinstalling manually."}
      </p>
      {state.notes && <p style={{ whiteSpace: "pre-wrap" }}>{state.notes}</p>}
      <div className="settings-actions">
        {state.phase === "ready" ? (
          <Button onClick={() => void desktopUpdater.restart()}>
            Restart app
          </Button>
        ) : state.phase === "available" ? (
          <Button onClick={() => void desktopUpdater.install()}>
            Download &amp; install
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void desktopUpdater.check()}
          >
            {state.phase === "installing"
              ? "Installing…"
              : state.phase === "checking"
                ? "Checking…"
                : "Check for updates"}
          </Button>
        )}
      </div>
    </section>
  );
}
