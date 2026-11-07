import { z } from "zod";

const fields = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000),
  doneWhen: z.string().max(2000),
  parentId: z.string().nullable(),
  kind: z.enum(["project", "task"]),
  minutes: z.number().int().min(1).max(480),
  today: z.boolean(),
  position: z.number().finite(),
  completed: z.boolean(),
  archived: z.boolean(),
});
export type TaskFields = z.infer<typeof fields>;
export type Task = TaskFields & { id: string };
const taskCreate = z.object({
  type: z.literal("task.create"),
  taskId: z.string().uuid(),
  fields,
});
const taskEdit = z.object({
  type: z.literal("task.edit"),
  taskId: z.string().uuid(),
  fields: fields.partial(),
});
const focusStart = z.object({
  type: z.literal("focus.start"),
  taskId: z.string().uuid(),
  sessionId: z.string().uuid(),
  at: z.number().finite(),
});
const focusChange = z.object({
  type: z.enum(["focus.pause", "focus.resume", "focus.stop"]),
  sessionId: z.string().uuid(),
  at: z.number().finite(),
});
export const actionSchema = z.discriminatedUnion("type", [
  taskCreate,
  taskEdit,
  focusStart,
  focusChange,
]);
export type Action = z.infer<typeof actionSchema>;
export type WorkspaceEvent = {
  id: string;
  actor_id: string;
  clock: number;
  created_at: string;
  payload: string;
};
export type Focus = {
  sessionId: string;
  taskId: string;
  startedAt: number | null;
  accumulated: number;
  stopped: boolean;
};
export type Workspace = {
  tasks: Task[];
  focus: Focus | null;
  events: WorkspaceEvent[];
  invalidCount: number;
};

export function parseAction(event: WorkspaceEvent): Action | null {
  try {
    return actionSchema.parse(JSON.parse(event.payload));
  } catch {
    return null;
  }
}

// A stable Lamport ordering converges after offline replay. Every version remains
// in the event log; field patches do not replace unrelated concurrent edits.
export function projectWorkspace(input: WorkspaceEvent[]): Workspace {
  const events = [
    ...new Map(input.map((event) => [event.id, event])).values(),
  ].sort(
    (a, b) =>
      a.clock - b.clock ||
      a.actor_id.localeCompare(b.actor_id) ||
      a.id.localeCompare(b.id),
  );
  const tasks = new Map<string, Task>();
  let focus: Focus | null = null;
  let invalidCount = 0;
  for (const event of events) {
    const action = parseAction(event);
    if (!action) {
      invalidCount++;
      continue;
    }
    if (action.type === "task.create") {
      if (!tasks.has(action.taskId))
        tasks.set(action.taskId, { id: action.taskId, ...action.fields });
    } else if (action.type === "task.edit") {
      const task = tasks.get(action.taskId);
      if (task) Object.assign(task, action.fields);
    } else if (action.type === "focus.start") {
      focus = {
        sessionId: action.sessionId,
        taskId: action.taskId,
        startedAt: action.at,
        accumulated: 0,
        stopped: false,
      };
    } else if (
      focus &&
      focus.sessionId === action.sessionId &&
      !focus.stopped
    ) {
      if (action.type === "focus.resume" && focus.startedAt === null)
        focus.startedAt = action.at;
      if (action.type !== "focus.resume") {
        if (focus.startedAt !== null)
          focus.accumulated += Math.max(0, action.at - focus.startedAt);
        focus.startedAt = null;
        if (action.type === "focus.stop") focus.stopped = true;
      }
    }
  }
  // Invalid parent links are shown at the root, never allowed to hide tasks or
  // recurse forever. The original values remain recoverable in history.
  for (const task of tasks.values()) {
    const seen = new Set([task.id]);
    let parent = task.parentId;
    while (parent) {
      if (seen.has(parent) || !tasks.has(parent)) {
        task.parentId = null;
        break;
      }
      seen.add(parent);
      parent = tasks.get(parent)!.parentId;
    }
  }
  return {
    tasks: [...tasks.values()].sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id),
    ),
    focus,
    events,
    invalidCount,
  };
}

export function elapsed(focus: Focus | null, now: number): number {
  return focus
    ? focus.accumulated +
        (focus.startedAt === null || focus.stopped
          ? 0
          : Math.max(0, now - focus.startedAt))
    : 0;
}
export function descendants(tasks: Task[], id: string): Set<string> {
  const found = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks)
      if (task.parentId && found.has(task.parentId) && !found.has(task.id)) {
        found.add(task.id);
        changed = true;
      }
  }
  return found;
}
export function taskDefaults(
  title: string,
  extra: Partial<TaskFields> = {},
): TaskFields {
  return {
    title,
    notes: "",
    doneWhen: "",
    parentId: null,
    kind: "task",
    minutes: 5,
    today: true,
    position: Date.now(),
    completed: false,
    archived: false,
    ...extra,
  };
}
export function taskPath(tasks: Task[], task: Task): string[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const path: string[] = [];
  let parent = task.parentId;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    path.unshift(item.title);
    parent = item.parentId;
  }
  return path;
}
