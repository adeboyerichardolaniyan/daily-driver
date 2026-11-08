import { useState, type FormEvent } from "react";
import { CalendarDays, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  planningSettingsSchema,
  type PlanningSettings as Preferences,
  type CalendarSnapshot,
} from "@/domain/planning";
import type { WorkspaceRepository } from "@/data/repository";
import { convex } from "@/data/sync";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
export function PlanningSettings({
  settings,
  sources,
  repository,
  account,
}: {
  settings: Preferences;
  sources: CalendarSnapshot[];
  repository: WorkspaceRepository;
  account: string | null;
}) {
  const [form, setForm] = useState(settings);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function perform(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const parsed = planningSettingsSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      await repository.append([
        { type: "planning.settings", settings: parsed.data },
      ]);
    }, "Planning preferences saved.");
  }
  return (
    <>
      <section className="settings-section">
        <div className="section-heading">
          <CalendarDays />
          <h2>Daily planning</h2>
        </div>
        <p>
          Prepare tomorrow in the evening and suggest adjustments as your day
          changes. You approve every change.
        </p>
        <form className="form-stack connection-form" onSubmit={save}>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Prepare plans automatically
          </label>
          <label>
            Timezone
            <Input
              required
              value={form.timeZone}
              placeholder="America/New_York"
              onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Work starts
              <Input
                required
                type="time"
                value={form.workStart}
                onChange={(e) =>
                  setForm({ ...form, workStart: e.target.value })
                }
              />
            </label>
            <label>
              Work ends
              <Input
                required
                type="time"
                value={form.workEnd}
                onChange={(e) => setForm({ ...form, workEnd: e.target.value })}
              />
            </label>
          </div>
          <fieldset className="planning-workdays">
            <legend>Working days</legend>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={form.workDays.includes(i + 1)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      workDays: e.target.checked
                        ? [...form.workDays, i + 1]
                        : form.workDays.filter((d) => d !== i + 1),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </fieldset>
          <label>
            Prepare tomorrow at
            <Input
              required
              type="time"
              value={form.eveningTime}
              onChange={(e) =>
                setForm({ ...form, eveningTime: e.target.value })
              }
            />
          </label>
          <div className="form-row">
            <label>
              Appointment buffer (minutes)
              <Input
                required
                type="number"
                min={0}
                max={60}
                value={form.bufferMinutes}
                onChange={(e) =>
                  setForm({ ...form, bufferMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Keep free each day (minutes)
              <Input
                required
                type="number"
                min={0}
                max={480}
                value={form.reserveMinutes}
                onChange={(e) =>
                  setForm({ ...form, reserveMinutes: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={form.allDayBusy}
              onChange={(e) =>
                setForm({ ...form, allDayBusy: e.target.checked })
              }
            />
            All-day busy events block the workday
          </label>
          <Button disabled={busy}>Save planning preferences</Button>
          <p className="ai-hint">
            Times use this timezone. Background planning runs within 15 minutes
            of your chosen time. Offline changes sync when you reconnect.
          </p>
        </form>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <CalendarDays />
          <h2>Calendars</h2>
        </div>
        <p>
          Connect a Google Calendar secret iCal address or an Outlook published
          ICS link. Calendars are read-only and refresh about every 15 minutes.
        </p>
        <div className="calendar-sources">
          {sources.map((source) => (
            <article key={source.id}>
              <div>
                <strong>{source.name}</strong>
                <p>
                  {source.refreshedAt
                    ? `Updated ${new Date(source.refreshedAt).toLocaleString()}`
                    : "Not synced yet"}
                </p>
                {source.error && <p className="error-text">{source.error}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Refresh ${source.name}`}
                disabled={!account || busy}
                onClick={() =>
                  void perform(async () => {
                    if (!convex)
                      throw new Error("Connect your workspace first.");
                    await convex.mutation(api.calendars.refresh, {
                      id: source.id as Id<"calendar_sources">,
                    });
                  }, "Refresh requested.")
                }
              >
                <RefreshCw />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Disconnect ${source.name}`}
                disabled={!account || busy}
                onClick={() =>
                  void perform(async () => {
                    if (!convex)
                      throw new Error("Connect your workspace first.");
                    await convex.mutation(api.calendars.remove, {
                      id: source.id as Id<"calendar_sources">,
                    });
                  }, "Calendar disconnected.")
                }
              >
                <Trash2 />
              </Button>
            </article>
          ))}
        </div>
        <form
          className="form-stack connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              if (!convex || !account)
                throw new Error("Sign in to connect a calendar.");
              await convex.mutation(api.calendars.add, { name, url });
              setName("");
              setUrl("");
            }, "Calendar connected. Fetching events…");
          }}
        >
          <label>
            Calendar name
            <Input
              required
              maxLength={100}
              value={name}
              placeholder="Personal calendar"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Private calendar link
            <Input
              required
              type="password"
              autoComplete="off"
              value={url}
              placeholder="https://…/calendar.ics"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <Button disabled={busy || !account}>Connect calendar</Button>
          {!account && (
            <p className="ai-hint">Sign in above to connect calendars.</p>
          )}
          <p className="ai-hint">
            The private link stays on the server. Only imported events sync to
            your devices. Changes at Google or Outlook may take longer to
            appear.
          </p>
        </form>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
