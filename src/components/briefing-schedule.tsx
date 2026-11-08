import { ChoiceSelect } from "./ui/choice-select";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { Workspace } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";
import {
  briefingScheduleSchema,
  type BriefingSchedule,
} from "@/domain/briefing-schedule";
import { convex, useConnection } from "@/data/sync";
import { api } from "../../convex/_generated/api";
export function BriefingScheduleSettings({
  workspace,
  repository,
}: {
  workspace: Workspace;
  repository: WorkspaceRepository;
}) {
  const [draft, setDraft] = useState<BriefingSchedule | null>(null);
  const settings = draft ?? workspace.briefingSchedule;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    lastDay: string | null;
    error: string | null;
  } | null>(null);
  const connection = useConnection();
  useEffect(() => {
    if (!convex || !connection.account) return;
    const watch = convex.watchQuery(api.briefings.status, {});
    const update = () => {
      try {
        setStatus(watch.localQueryResult() ?? null);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Schedule status unavailable.",
        );
      }
    };
    const unsubscribe = watch.onUpdate(update);
    update();
    return unsubscribe;
  }, [connection.account]);
  function edit(patch: Partial<BriefingSchedule>) {
    setDraft({ ...settings, ...patch });
    setMessage("");
  }
  return (
    <section
      className="briefing-schedule briefing-settings-group form-stack"
      aria-labelledby="briefing-schedule-heading"
    >
      <header className="briefing-group-heading">
        <div>
          <h3 id="briefing-schedule-heading">Daily delivery</h3>
          <p>Prepare one briefing each day, even with the app closed.</p>
        </div>
      </header>
      <label className="briefing-schedule-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => edit({ enabled: e.target.checked })}
        />{" "}
        Prepare automatically
      </label>
      <div className="briefing-schedule-fields">
        <label>
          Time
          <Input
            aria-label="Briefing time"
            type="time"
            value={settings.time}
            onChange={(e) => edit({ time: e.target.value })}
          />
        </label>
        <label>
          Output
          <ChoiceSelect
            aria-label="Briefing output"
            value={settings.output}
            onChange={(e) =>
              edit({ output: e.target.value as "pdf" | "printer" })
            }
          >
            <option value="pdf">PDF only</option>
            <option value="printer">Receipt printer</option>
          </ChoiceSelect>
        </label>
      </div>
      <small>
        {workspace.planningSettings.timeZone} · Once per day, using your saved
        template.
      </small>
      <div className="briefing-link-settings">
        <h4>Phone link</h4>
        <label>
          App URL
          <Input
            aria-label="Briefing app URL"
            type="url"
            value={
              settings.appUrl === "https://example.invalid"
                ? import.meta.env.VITE_PUBLIC_APP_URL || ""
                : settings.appUrl
            }
            placeholder="https://your-app.example"
            onChange={(e) => edit({ appUrl: e.target.value })}
          />
        </label>
        <small>
          {settings.output === "pdf"
            ? "PDFs are saved on the Mac mini when its worker is running. Without an app URL, the QR is a placeholder."
            : "Requires a configured printer and a worker running in printer mode."}
        </small>
      </div>
      <div>
        <Button
          disabled={busy || !connection.account}
          onClick={async () => {
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const appUrl =
                settings.appUrl === "https://example.invalid"
                  ? import.meta.env.VITE_PUBLIC_APP_URL || settings.appUrl
                  : settings.appUrl;
              const value = briefingScheduleSchema.parse({
                ...settings,
                appUrl,
              });
              if (
                value.output === "printer" &&
                new URL(appUrl).hostname.endsWith(".invalid")
              )
                throw new Error(
                  "Enter your public app URL before choosing a printer.",
                );
              await repository.append([
                { type: "briefing.schedule", settings: value },
              ]);
              setDraft(null);
              setMessage("Schedule saved. It takes effect once synced.");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not save schedule.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save schedule
        </Button>
      </div>
      {status?.lastDay && <small>Last prepared: {status.lastDay}</small>}
      {status?.error && <p role="status">{status.error}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
