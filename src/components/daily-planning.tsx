import { useState } from "react";
import { CalendarDays, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useClock } from "@/lib/clock";
import {
  availability,
  calendarEventsForDay,
  calendarWarnings,
  nextDate,
  planApprovalIssue,
  zonedDate,
  type DailyPlan,
} from "@/domain/planning";
import type { Workspace } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";
export function DailyPlanning({
  workspace,
  repository,
  account,
}: {
  workspace: Workspace;
  repository: WorkspaceRepository;
  account: string | null;
}) {
  const now = useClock(),
    settings = workspace.planningSettings;
  const today = zonedDate(now, settings.timeZone);
  const [tomorrow, setTomorrow] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const date = tomorrow ? nextDate(today) : today;
  const plan = workspace.dailyPlans
    .filter((p) => p.date === date)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const available = availability(date, settings, workspace.calendars, now);
  const warnings = calendarWarnings(workspace.calendars, date, settings, now);
  const events = calendarEventsForDay(
    workspace.calendars,
    date,
    settings.timeZone,
  );
  async function request() {
    setBusy(true);
    setError("");
    try {
      await repository.append([
        { type: "planning.request", planId: crypto.randomUUID(), date },
      ]);
      setOpen(true);
    } catch {
      setError("Could not save this request. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="daily-planning" aria-label="Daily planning">
      <div className="daily-planning-summary">
        <CalendarDays />
        <div>
          <strong>{tomorrow ? "Tomorrow’s plan" : "Today’s plan"}</strong>
          <small>
            {warnings.length
              ? "Calendar availability needs a refresh"
              : `${available.minutes} min available · ${events.length} calendar ${events.length === 1 ? "event" : "events"}`}{" "}
            · {settings.timeZone}
          </small>
        </div>
      </div>
      <div className="daily-planning-actions">
        <Button variant="ghost" onClick={() => setTomorrow(!tomorrow)}>
          {tomorrow ? "Today" : "Tomorrow"}
        </Button>
        {plan && plan.status !== "dismissed" ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {plan.status === "ready"
              ? "Review plan"
              : plan.status === "approved"
                ? "View plan"
                : plan.status === "failed"
                  ? "Review issue"
                  : "Plan pending"}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void request()}
          >
            <Sparkles />
            Prepare plan
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="planning-dialog">
          <DialogHeader>
            <DialogTitle>
              {tomorrow ? "Tomorrow’s plan" : "Today’s plan"}
            </DialogTitle>
            <DialogDescription>
              {date} · {settings.timeZone}. Changes require your approval.
            </DialogDescription>
          </DialogHeader>
          {plan ? (
            <PlanReview
              key={`${plan.id}:${plan.status}`}
              plan={plan}
              workspace={workspace}
              repository={repository}
              now={now}
              onRequest={request}
            />
          ) : (
            <p>Saving your request…</p>
          )}
          {!account && (
            <p className="ai-hint">
              Your request is saved locally. Sign in to generate a plan.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function PlanReview({
  plan,
  workspace,
  repository,
  now,
  onRequest,
}: {
  plan: DailyPlan;
  workspace: Workspace;
  repository: WorkspaceRepository;
  now: number;
  onRequest: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(() =>
      plan.blocks.map((b) => b.taskId),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const issue = planApprovalIssue(
    plan,
    selected,
    workspace.tasks,
    workspace.calendars,
    workspace.planningSettings,
    now,
    workspace.focus &&
      !workspace.focus.stopped &&
      workspace.focus.startedAt !== null
      ? workspace.focus.taskId
      : undefined,
  );
  const time = (value: number) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: workspace.planningSettings.timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(value);
  async function act(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await repository.append([
        approve
          ? { type: "planning.approve", planId: plan.id, taskIds: selected }
          : { type: "planning.dismiss", planId: plan.id },
      ]);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="plan-review">
      <p role="status">
        {plan.status === "approved"
          ? "Approved. Your scheduled tasks stay in place until you choose to change them."
          : plan.status === "dismissed"
            ? "Suggestion dismissed."
            : plan.message}
      </p>
      {plan.status === "ready" && issue && (
        <p className="error-text">{issue}</p>
      )}
      <ol className="plan-blocks">
        {plan.blocks.map((block) => {
          const task = workspace.tasks.find((t) => t.id === block.taskId);
          return (
            <li key={block.taskId}>
              <label>
                <input
                  type="checkbox"
                  disabled={plan.status !== "ready" || busy}
                  checked={selected.includes(block.taskId)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, block.taskId]
                        : selected.filter((id) => id !== block.taskId),
                    )
                  }
                />
                <span>
                  <strong>{task?.title ?? "Unavailable task"}</strong>
                  <small>
                    {time(block.start)}–{time(block.end)} · {task?.minutes} min
                  </small>
                  <p>{block.reason}</p>
                  {task?.plannedStart && task.plannedStart !== block.start && (
                    <small>Moves from {time(task.plannedStart)}</small>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
      {plan.status === "ready" && (
        <p className="ai-hint">
          Selected steps will be scheduled for {plan.date}. Unselected and other
          existing tasks stay unchanged.
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="plan-review-actions">
        {plan.status === "ready" && (
          <Button
            disabled={busy || Boolean(issue) || !selected.length}
            onClick={() => void act(true)}
          >
            Approve {selected.length} {selected.length === 1 ? "step" : "steps"}
          </Button>
        )}
        {!["queued", "waiting"].includes(plan.status) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onRequest()}
          >
            Prepare fresh plan
          </Button>
        )}
        {!["approved", "dismissed"].includes(plan.status) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act(false)}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
