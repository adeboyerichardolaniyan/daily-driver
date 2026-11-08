import { useState } from "react";
import { Check, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { draftStepSchema, type PlanStep, type Proposal } from "@/domain/ai";
import type { Task } from "@/domain/workspace";
import type { WorkspaceRepository } from "@/data/repository";

export function AIPanel({
  tasks,
  proposals,
  target,
  easier,
  account,
  connected,
  repository,
  onManual,
}: {
  tasks: Task[];
  proposals: Proposal[];
  target?: Task;
  easier: boolean;
  account: string | null;
  connected: boolean;
  repository: WorkspaceRepository;
  onManual: (parentId?: string) => void;
}) {
  const [sourceId, setSourceId] = useState(target?.id ?? "new");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [editing, setEditing] = useState<{
    requestId: string;
    step: PlanStep;
    adding?: boolean;
  } | null>(null);
  const source = tasks.find((task) => task.id === sourceId);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      await work();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const visible = proposals
    .filter((plan) => !["approved", "canceled"].includes(plan.status))
    .slice()
    .reverse();
  return (
    <div className="ai-panel-body">
      <form
        className="form-stack ai-request-form"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await repository.append([
              {
                type: "ai.request",
                requestId: crypto.randomUUID(),
                mode: easier ? "easier" : "breakdown",
                source: {
                  taskId: source?.id ?? null,
                  title: source?.title ?? description.trim(),
                  notes: source?.notes ?? "",
                  context: source ? description.trim() : "",
                  doneWhen: source?.doneWhen ?? "",
                  existingSteps: source
                    ? tasks
                        .filter(
                          (task) =>
                            task.parentId === source.id && !task.archived,
                        )
                        .slice(0, 50)
                        .map((task) => task.title)
                    : [],
                },
              },
            ]);
            setDescription("");
          });
        }}
      >
        <label>
          Start with
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger aria-label="Task to break down">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">A new goal</SelectItem>
              {tasks
                .filter((task) => !task.archived && !task.completed)
                .map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          {source ? "Additional context" : "What do you want to get done?"}
          <Textarea
            required={!source}
            maxLength={source ? 10000 : 500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={
              source
                ? "What feels difficult? Where are you stuck?"
                : "Update my portfolio case studies so I can apply for jobs"
            }
          />
        </label>
        <Button disabled={busy || (!source && !description.trim())}>
          <Sparkles />
          {busy ? "Saving…" : easier ? "Suggest smaller steps" : "Draft a plan"}
        </Button>
        <p className="ai-hint">
          Review and approve before anything joins your tasks.
        </p>
        {!account && (
          <p className="ai-hint">
            Requests save locally. Sign in through Settings to generate drafts.
          </p>
        )}
        {account && !connected && (
          <p className="ai-hint">
            Offline · requests will send when you reconnect.
          </p>
        )}
      </form>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {confirmation && (
        <p role="status" className="ai-hint">
          {confirmation}
        </p>
      )}
      <div className="ai-proposals" aria-label="AI drafts">
        {!visible.length && (
          <p className="ai-hint">Your drafts will appear here.</p>
        )}
        {visible.map((plan) => (
          <PlanReview
            key={plan.requestId}
            plan={plan}
            tasks={tasks}
            busy={busy}
            onAdd={() =>
              setEditing({
                requestId: plan.requestId,
                adding: true,
                step: {
                  id: crypto.randomUUID(),
                  title: "",
                  notes: "",
                  doneWhen: "",
                  minutes: 5,
                },
              })
            }
            onEdit={(step) => setEditing({ requestId: plan.requestId, step })}
            onRemove={(stepId) =>
              void perform(() =>
                repository.append([
                  { type: "ai.remove", requestId: plan.requestId, stepId },
                ]),
              )
            }
            onCancel={() =>
              void perform(() =>
                repository.append([
                  { type: "ai.cancel", requestId: plan.requestId },
                ]),
              )
            }
            onRetry={() =>
              void perform(() =>
                repository.append([
                  { type: "ai.cancel", requestId: plan.requestId },
                  {
                    type: "ai.request",
                    requestId: crypto.randomUUID(),
                    mode: plan.mode,
                    source: plan.source,
                  },
                ]),
              )
            }
            onApprove={(today) =>
              void perform(async () => {
                await repository.append([
                  { type: "ai.approve", requestId: plan.requestId, today },
                ]);
                setConfirmation(
                  today
                    ? "Approved steps added to Today."
                    : "Approved steps added to your backlog.",
                );
              })
            }
          />
        ))}
      </div>
      <Button
        variant="ghost"
        className="ai-manual"
        onClick={() => onManual(source?.id)}
      >
        <Plus />
        Create a separate task
      </Button>
      {editing && (
        <StepEditor
          step={editing.step}
          adding={editing.adding}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            await repository.append([
              editing.adding
                ? {
                    type: "ai.add",
                    requestId: editing.requestId,
                    step: fields,
                  }
                : {
                    type: "ai.edit",
                    requestId: editing.requestId,
                    stepId: editing.step.id,
                    fields,
                  },
            ]);
          }}
        />
      )}
    </div>
  );
}

function PlanReview({
  plan,
  tasks,
  busy,
  onEdit,
  onAdd,
  onRemove,
  onCancel,
  onRetry,
  onApprove,
}: {
  plan: Proposal;
  tasks: Task[];
  busy: boolean;
  onEdit: (step: PlanStep) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onApprove: (today: boolean) => void;
}) {
  const [today, setToday] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const source = tasks.find((task) => task.id === plan.source.taskId);
  const unavailable = Boolean(
    plan.source.taskId && (!source || source.archived || source.completed),
  );
  const changed = Boolean(
    source &&
    (source.title !== plan.source.title ||
      plan.source.notes !== source.notes ||
      source.doneWhen !== plan.source.doneWhen),
  );
  return (
    <section className="ai-plan" aria-label={`Draft: ${plan.source.title}`}>
      <div className="ai-plan-heading">
        <span className="subtle-badge">
          {
            {
              queued: "Queued",
              running: "Drafting",
              ready: "Review draft",
              failed: "Needs attention",
              approved: "Approved",
              canceled: "Canceled",
            }[plan.status]
          }
        </span>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Discard
        </Button>
      </div>
      <h3>{plan.source.title}</h3>
      {(plan.status === "queued" || plan.status === "running") && (
        <p role="status" className="ai-hint">
          {plan.error ??
            (plan.status === "queued"
              ? "Saved · waiting to generate"
              : "Breaking this into manageable steps…")}
        </p>
      )}
      {plan.status === "failed" && (
        <>
          <p role="alert" className="error-text">
            {plan.error}
          </p>
          <Button variant="outline" disabled={busy} onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
      {plan.status === "ready" && (
        <>
          <ol className="ai-steps">
            {plan.steps.map((step, index) => (
              <li key={step.id}>
                <span className="ai-step-number">{index + 1}</span>
                <div className="ai-step-copy">
                  <strong>{step.title}</strong>
                  <span className="ai-step-time">{step.minutes} min</span>
                  {step.notes && <p>{step.notes}</p>}
                  <p className="ai-done">
                    <Check size={13} />
                    {step.doneWhen}
                  </p>
                  <div className="ai-step-tools">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onEdit(step)}
                      aria-label={`Edit suggested step ${index + 1}`}
                    >
                      <Pencil />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRemove(step.id)}
                      aria-label={`Remove suggested step ${index + 1}`}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <Button
            variant="ghost"
            className="ai-add-step"
            disabled={busy || unavailable}
            onClick={onAdd}
          >
            <Plus />
            Add a step
          </Button>
          {unavailable && (
            <p className="error-text">
              The original task is completed, archived, or unavailable. Discard
              this draft and start from a current task.
            </p>
          )}
          {changed && !unavailable && (
            <label className="ai-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              The task changed since this draft. I’ve reviewed these steps.
            </label>
          )}
          <label className="ai-check">
            <input
              type="checkbox"
              checked={today}
              onChange={(event) => setToday(event.target.checked)}
            />
            Add approved steps to Today
          </label>
          <Button
            disabled={
              busy ||
              !plan.steps.length ||
              unavailable ||
              (changed && !acknowledged)
            }
            onClick={() => onApprove(today)}
          >
            <Check />
            Approve {plan.steps.length}{" "}
            {plan.steps.length === 1 ? "step" : "steps"}
          </Button>
        </>
      )}
    </section>
  );
}

function StepEditor({
  step,
  adding = false,
  onSave,
  onClose,
}: {
  step: PlanStep;
  adding?: boolean;
  onSave: (fields: PlanStep) => Promise<void>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="editor-dialog">
        <DialogHeader>
          <DialogTitle>
            {adding ? "Add a draft step" : "Edit draft step"}
          </DialogTitle>
          <DialogDescription>
            Changes stay in the draft until approval.
          </DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            try {
              const parsed = draftStepSchema.parse(fields);
              await onSave({ ...parsed, id: fields.id });
              onClose();
            } catch {
              setError(
                "Could not save this step. Check its fields and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Title
            <Input
              autoFocus
              required
              maxLength={200}
              value={fields.title}
              onChange={(event) =>
                setFields({ ...fields, title: event.target.value })
              }
            />
          </label>
          <label>
            Context
            <Textarea
              maxLength={2000}
              value={fields.notes}
              onChange={(event) =>
                setFields({ ...fields, notes: event.target.value })
              }
            />
          </label>
          <label>
            Done when
            <Input
              required
              maxLength={500}
              value={fields.doneWhen}
              onChange={(event) =>
                setFields({ ...fields, doneWhen: event.target.value })
              }
            />
          </label>
          <label>
            Minutes
            <Input
              required
              type="number"
              min={1}
              max={30}
              value={fields.minutes}
              onChange={(event) =>
                setFields({ ...fields, minutes: Number(event.target.value) })
              }
            />
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={busy}>
              {busy ? "Saving…" : adding ? "Add to draft" : "Save draft step"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
