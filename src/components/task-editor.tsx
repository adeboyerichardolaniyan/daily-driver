import { dateKey } from "@/domain/calendar";
import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  descendants,
  taskDefaults,
  type Task,
  type TaskFields,
} from "@/domain/workspace";

export function TaskEditor({
  task,
  tasks,
  parentId,
  kind = "task",
  scheduledDate,
  today,
  position,
  onSave,
  onClose,
  onDelete,
}: {
  task?: Task;
  tasks: Task[];
  parentId?: string;
  kind?: "task" | "project";
  scheduledDate?: string | null;
  today?: boolean;
  position?: number;
  onSave: (fields: TaskFields) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [fields, setFields] = useState<TaskFields>(
    task ??
      taskDefaults("", {
        parentId: parentId ?? null,
        kind,
        today: today ?? (!scheduledDate && kind !== "project"),
        scheduledDate,
        ...(position !== undefined ? { position } : {}),
      }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = task ? descendants(tasks, task.id) : new Set<string>();
  function patch<K extends keyof TaskFields>(key: K, value: TaskFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(fields);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save your changes.",
      );
    } finally {
      setBusy(false);
    }
  }
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
            {task ? "Edit" : "New"}{" "}
            {fields.kind === "project" ? "project" : "task"}
          </DialogTitle>
          <DialogDescription>
            {fields.parentId
              ? `Adding ${task ? "details" : "a step"} in ${tasks.find((t) => t.id === fields.parentId)?.title ?? "this list"}.`
              : "Set the next action and what finishing it looks like."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label>
            Title
            <Input
              autoFocus
              required
              maxLength={500}
              value={fields.title}
              placeholder="What would you like to move forward?"
              onChange={(e) => patch("title", e.target.value)}
            />
          </label>
          <label>
            Belongs to
            <Select
              value={fields.parentId ?? "none"}
              onValueChange={(value) =>
                patch("parentId", value === "none" ? null : value)
              }
            >
              <SelectTrigger aria-label="Belongs to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standalone</SelectItem>
                {tasks
                  .filter((t) => !t.archived && !blocked.has(t.id))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            Context
            <Textarea
              value={fields.notes}
              maxLength={20000}
              placeholder="Useful details, a starting point, or a link…"
              onChange={(e) => patch("notes", e.target.value)}
            />
          </label>
          <label>
            Done when
            <Input
              value={fields.doneWhen}
              maxLength={2000}
              placeholder="What does finishing this step look like?"
              onChange={(e) => patch("doneWhen", e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              Estimated minutes
              <Input
                type="number"
                min={1}
                max={480}
                required
                value={fields.minutes}
                onChange={(e) => patch("minutes", Number(e.target.value))}
              />
            </label>
            <label>
              Plan
              <Select
                value={
                  fields.scheduledDate != null
                    ? "scheduled"
                    : fields.today
                      ? "today"
                      : "backlog"
                }
                onValueChange={(value) =>
                  setFields((current) => ({
                    ...current,
                    today: value === "today",
                    scheduledDate: value === "scheduled" ? dateKey() : null,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="scheduled">On a date</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          {fields.scheduledDate != null && (
            <label>
              Scheduled date
              <Input
                type="date"
                required
                value={fields.scheduledDate}
                onChange={(event) => patch("scheduledDate", event.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <DialogFooter>
            {task && onDelete && (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={onDelete}
              >
                Delete {task.kind}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={busy || !fields.title.trim()}>
              {busy ? "Saving…" : "Save " + fields.kind}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
