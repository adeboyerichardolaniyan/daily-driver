import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  actionSchema,
  compareWorkspaceEvents,
  descendants,
  type Task,
  taskDefaults,
  type Action,
  type WorkspaceEvent,
  type TaskFields,
} from "@/domain/workspace";

export class WorkspaceRepository {
  private actor = crypto.randomUUID();
  constructor(private db: AbstractPowerSyncDatabase) {}

  async append(actions: Action[]) {
    const parsed = actions.map((action) => actionSchema.parse(action));
    await this.db.writeTransaction(async (tx) => {
      const row = await tx.get<{ clock: number }>(
        "SELECT COALESCE(MAX(clock), 0) AS clock FROM event_log",
      );
      let clock = row.clock;
      for (const action of parsed) {
        await tx.execute(
          "INSERT INTO event_log (id, actor_id, clock, created_at, payload, uploaded) VALUES (?, ?, ?, ?, ?, 0)",
          [
            crypto.randomUUID(),
            this.actor,
            ++clock,
            new Date().toISOString(),
            JSON.stringify(action),
          ],
        );
      }
    });
  }
  async create(fields: TaskFields) {
    const taskId = crypto.randomUUID();
    await this.append([{ type: "task.create", taskId, fields }]);
    return taskId;
  }
  edit(taskId: string, fields: Partial<TaskFields>) {
    return this.append([{ type: "task.edit", taskId, fields }]);
  }
  async deleteTask(task: Task, tasks: Task[]) {
    const ids = [...descendants(tasks, task.id)];
    await this.append([
      { type: "object.delete", kind: "task", id: task.id, relatedIds: ids },
    ]);
  }
  async example() {
    // Explicit, user-requested sample. These are authored examples, not AI output.
    const project = crypto.randomUUID();
    const study = crypto.randomUUID();
    const steps = [
      [
        "Open your first case study",
        "Find the current draft or live page. No editing yet.",
        "The case study is open in front of you.",
        2,
      ],
      [
        "Write down what needs updating",
        "Read once and capture three things that feel out of date.",
        "You have a short list of changes.",
        5,
      ],
      [
        "Choose one outcome to highlight",
        "Look for a result, a customer insight, or a decision you helped make.",
        "One concrete outcome is written down.",
        5,
      ],
      [
        "Rewrite the opening paragraph",
        "Say who the work was for, what needed to change, and what you did.",
        "You have a rough opening. It does not need to be polished.",
        10,
      ],
    ] as const;
    await this.append([
      {
        type: "task.create",
        taskId: project,
        fields: taskDefaults("Get ready to apply", {
          kind: "project",
          today: false,
          position: 0,
        }),
      },
      {
        type: "task.create",
        taskId: study,
        fields: taskDefaults("Update portfolio case studies", {
          parentId: project,
          today: false,
          position: 1,
          notes: "Make the work clear, current, and ready to share.",
        }),
      },
      ...steps.map(([title, notes, doneWhen, minutes], index): Action => ({
        type: "task.create",
        taskId: crypto.randomUUID(),
        fields: taskDefaults(title, {
          parentId: study,
          notes,
          doneWhen,
          minutes,
          position: index + 2,
        }),
      })),
    ]);
    return project;
  }
  async exportEvents(): Promise<WorkspaceEvent[]> {
    const events = await this.db.getAll<WorkspaceEvent>(
      "SELECT * FROM event_log ORDER BY clock, actor_id",
    );
    return events.sort(compareWorkspaceEvents);
  }
}
