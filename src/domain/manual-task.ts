import type { Task } from "./workspace";

// A sibling belongs to the same list and inherits the selected step's plan.
export function stepAfter(task: Task, tasks: Task[]) {
  const next = tasks
    .filter(
      (t) =>
        !t.archived &&
        t.parentId === task.parentId &&
        t.position > task.position,
    )
    .sort((a, b) => a.position - b.position)[0];
  return {
    parentId: task.parentId ?? undefined,
    today: task.today,
    scheduledDate: task.scheduledDate ?? null,
    position: next
      ? task.position + (next.position - task.position) / 2
      : task.position + 1,
  };
}
