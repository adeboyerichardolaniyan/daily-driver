import {
  briefingScheduleSchema,
  defaultBriefingSchedule,
  type BriefingSchedule,
} from "./briefing-schedule";
import { weatherSnapshotSchema, type WeatherSnapshot } from "./weather";
import {
  contentActions,
  dailyContent,
  type ContentCollection,
  type ContentRequest,
  type ContentEntry,
} from "./content-collections";
import { receiptSchema, type ReceiptSnapshot } from "./receipt-schema";
import {
  briefingTemplateSchema,
  defaultBriefingTemplate,
  type BriefingTemplate,
} from "./briefing";
import {
  planningActions,
  zonedDate,
  defaultPlanningSettings,
  planningBasis,
  planApprovalIssue,
  type PlanningSettings,
  type CalendarSnapshot,
  type DailyPlan,
} from "./planning";
import { z } from "zod";
import { aiActions, type Proposal } from "./ai";

const fields = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000),
  doneWhen: z.string().max(2000),
  parentId: z.string().nullable(),
  kind: z.enum(["project", "task"]),
  minutes: z.number().int().min(1).max(480),
  today: z.boolean(),
  scheduledDate: z.iso.date().nullable().optional(),
  position: z.number().finite(),
  plannedStart: z.number().nullable().optional(),
  plannedEnd: z.number().nullable().optional(),
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
  z.object({
    type: z.literal("object.delete"),
    kind: z.enum([
      "task",
      "proposal",
      "plan",
      "briefing",
      "collection",
      "entry",
      "calendarEvent",
      "weather",
      "focus",
      "contentRequest",
    ]),
    id: z.string().min(1).max(1000),
    relatedIds: z.array(z.string().uuid()).max(1000).optional(),
  }),
  focusStart,
  focusChange,
  ...aiActions,
  ...planningActions,
  ...contentActions,
  z.object({
    type: z.literal("weather.snapshot"),
    snapshot: weatherSnapshotSchema,
  }),
  z.object({
    type: z.literal("briefing.issue"),
    date: z.iso.date(),
    snapshot: receiptSchema,
  }),
  z.object({
    type: z.literal("briefing.schedule"),
    settings: briefingScheduleSchema,
  }),
  z.object({
    type: z.literal("briefing.template"),
    template: briefingTemplateSchema,
  }),
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
  proposals: Proposal[];
  planningSettings: PlanningSettings;
  calendars: CalendarSnapshot[];
  dailyPlans: DailyPlan[];
  briefingTemplate: BriefingTemplate;
  briefingSchedule: BriefingSchedule;
  weatherSnapshots: Record<string, WeatherSnapshot>;
  contentCollections: ContentCollection[];
  contentRequests: ContentRequest[];
  contentPicks: Record<string, ContentEntry>;
  issuedBriefings: Record<string, ReceiptSnapshot>;
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
  const weatherSnapshots: Record<string, WeatherSnapshot> = {};
  const contentCollections = new Map<string, ContentCollection>();
  const contentRequests = new Map<string, ContentRequest>();
  const contentPicks: Record<string, ContentEntry> = {};
  const issuedBriefings: Record<string, ReceiptSnapshot> = {};
  let planningSettings = defaultPlanningSettings();
  let briefingTemplate = defaultBriefingTemplate();
  let briefingSchedule = defaultBriefingSchedule();
  const calendars = new Map<string, CalendarSnapshot>();
  const dailyPlans = new Map<string, DailyPlan>();
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
  const proposals = new Map<string, Proposal>();
  let invalidCount = 0;
  // UUID objects use delete-wins tombstones, independent of upload order.
  // Late edits, old replicas and AI responses cannot recreate the same object.
  const deleted = new Map<string, Set<string>>();
  const mark = (kind: string, id: string) => {
    if (!deleted.has(kind)) deleted.set(kind, new Set());
    deleted.get(kind)!.add(id);
  };
  const gone = (kind: string, id: string) =>
    deleted.get(kind)?.has(id) ?? false;
  for (const event of events) {
    const action = parseAction(event);
    if (
      action?.type === "object.delete" &&
      !["briefing", "weather"].includes(action.kind)
    ) {
      mark(action.kind, action.id);
      if (action.kind === "task")
        for (const id of action.relatedIds ?? []) mark("task", id);
    }
    if (action?.type === "content.removeCollection")
      mark("collection", action.collectionId);
    if (action?.type === "content.removeEntry") mark("entry", action.entryId);
    if (action?.type === "calendar.remove") mark("calendar", action.sourceId);
  }
  const removedRequests = new Set<string>();
  const removedPlans = new Set<string>();
  const removedCalendars = new Set<string>();
  for (const event of events) {
    const action = parseAction(event);
    if (!action) {
      invalidCount++;
      continue;
    }
    if (action.type === "object.delete") {
      // These use reusable date/location keys: a later explicit save/refresh is a new object.
      if (action.kind === "proposal" || action.kind === "contentRequest")
        removedRequests.add(action.id);
      if (action.kind === "plan") removedPlans.add(action.id);
      if (action.kind === "briefing") delete issuedBriefings[action.id];
      if (action.kind === "weather") delete weatherSnapshots[action.id];
      continue;
    }
    if ("requestId" in action && removedRequests.has(action.requestId))
      continue;
    if ("planId" in action && removedPlans.has(action.planId)) continue;
    if (action.type === "planning.result" && removedPlans.has(action.plan.id))
      continue;
    if (
      action.type === "content.collection" &&
      gone("collection", action.collection.id)
    )
      continue;
    if ("collectionId" in action && gone("collection", action.collectionId))
      continue;
    if (action.type === "content.entry" && gone("entry", action.entry.id))
      continue;
    if (
      action.type === "content.request" &&
      gone("collection", action.collection.id)
    )
      continue;
    if (
      action.type === "calendar.snapshot" &&
      removedCalendars.has(action.source.id)
    )
      continue;
    if ("sessionId" in action && gone("focus", action.sessionId)) continue;
    if (action.type === "weather.snapshot") {
      const previous = weatherSnapshots[action.snapshot.key];
      if (!previous || previous.fetchedAt < action.snapshot.fetchedAt)
        weatherSnapshots[action.snapshot.key] = action.snapshot;
      continue;
    }
    if (action.type === "briefing.issue") {
      issuedBriefings[action.date] ??= action.snapshot;
      continue;
    }
    const latchContent = (collectionId: string) => {
      const collection = contentCollections.get(collectionId);
      const date = zonedDate(
        Date.parse(event.created_at),
        planningSettings.timeZone,
      );
      const key = `${collectionId}:${date}`;
      if (collection && !contentPicks[key]) {
        const entry = dailyContent(collection, date, contentPicks);
        if (entry) contentPicks[key] = { ...entry };
      }
    };
    if (action.type === "content.collection") {
      contentCollections.set(action.collection.id, {
        ...action.collection,
        entries: contentCollections.get(action.collection.id)?.entries ?? [],
      });
      continue;
    }
    if (action.type === "content.removeCollection") {
      contentCollections.delete(action.collectionId);
      continue;
    }
    if (action.type === "content.entry") {
      latchContent(action.collectionId);
      const c = contentCollections.get(action.collectionId);
      if (c)
        c.entries = [
          ...c.entries.filter((e) => e.id !== action.entry.id),
          action.entry,
        ];
      latchContent(action.collectionId);
      continue;
    }
    if (action.type === "content.removeEntry") {
      latchContent(action.collectionId);
      const c = contentCollections.get(action.collectionId);
      if (c) c.entries = c.entries.filter((e) => e.id !== action.entryId);
      continue;
    }
    if (action.type === "content.pick") {
      if (action.entry.approved)
        contentPicks[`${action.collectionId}:${action.date}`] = action.entry;
      continue;
    }
    if (action.type === "content.request") {
      contentRequests.set(action.requestId, {
        ...action,
        status: "queued",
        message: "Waiting for AI.",
      });
      continue;
    }
    if (action.type === "content.result") {
      const request = contentRequests.get(action.requestId);
      if (request && request.status !== "ready") {
        request.status = action.status;
        request.message = action.message;
        const c = contentCollections.get(request.collection.id);
        if (c && action.status === "ready")
          for (const entry of action.entries)
            if (
              !gone("entry", entry.id) &&
              !c.entries.some((e) => e.id === entry.id)
            )
              c.entries.push({ ...entry, approved: false });
      }
      continue;
    }
    if (action.type === "briefing.schedule") {
      briefingSchedule = action.settings;
      continue;
    }
    if (action.type === "briefing.template") {
      briefingTemplate = action.template;
      continue;
    }
    if (action.type === "planning.settings") {
      planningSettings = action.settings;
      continue;
    }
    if (action.type === "calendar.snapshot") {
      calendars.set(action.source.id, action.source);
      continue;
    }
    if (action.type === "calendar.remove") {
      removedCalendars.add(action.sourceId);
      calendars.delete(action.sourceId);
      continue;
    }
    if (action.type === "planning.request") {
      if (!dailyPlans.has(action.planId))
        dailyPlans.set(action.planId, {
          id: action.planId,
          date: action.date,
          basis: "",
          createdAt: Date.parse(event.created_at),
          status: "queued",
          blocks: [],
          availableMinutes: 0,
          message: "Waiting to prepare your day.",
        });
      continue;
    }
    if (action.type === "planning.result") {
      const previous = dailyPlans.get(action.plan.id);
      if (!previous || !["approved", "dismissed"].includes(previous.status))
        dailyPlans.set(action.plan.id, action.plan);
      continue;
    }
    if (action.type === "planning.dismiss") {
      const plan = dailyPlans.get(action.planId);
      if (plan && plan.status !== "approved") plan.status = "dismissed";
      continue;
    }
    if (action.type === "planning.approve") {
      const plan = dailyPlans.get(action.planId);
      if (
        plan?.status !== "ready" ||
        plan.basis !==
          planningBasis(
            [...tasks.values()],
            [...calendars.values()],
            planningSettings,
            plan.date,
          )
      )
        continue;
      const selected = plan.blocks.filter((b) =>
        action.taskIds.includes(b.taskId),
      );
      if (
        !selected.length ||
        planApprovalIssue(
          plan,
          action.taskIds,
          [...tasks.values()],
          [...calendars.values()],
          planningSettings,
          Date.parse(event.created_at),
          focus && !focus.stopped && focus.startedAt !== null
            ? focus.taskId
            : undefined,
        )
      )
        continue;
      for (const block of selected) {
        const task = tasks.get(block.taskId);
        if (task && !task.completed && !task.archived)
          Object.assign(task, {
            today: false,
            scheduledDate: plan.date,
            plannedStart: block.start,
            plannedEnd: block.end,
            position: block.start,
          });
      }
      plan.status = "approved";
      plan.blocks = selected;
      plan.basis = planningBasis(
        [...tasks.values()],
        [...calendars.values()],
        planningSettings,
        plan.date,
      );
      continue;
    }
    if ("requestId" in action) {
      const proposal = proposals.get(action.requestId);
      if (action.type === "ai.request") {
        if (!proposal)
          proposals.set(action.requestId, {
            ...action,
            status: "queued",
            steps: [],
          });
      } else if (
        proposal &&
        proposal.status !== "canceled" &&
        proposal.status !== "approved"
      ) {
        if (
          action.type === "ai.waiting" &&
          ["queued", "running"].includes(proposal.status)
        ) {
          proposal.status = "queued";
          proposal.error = action.error;
        }
        if (action.type === "ai.cancel") proposal.status = "canceled";
        if (action.type === "ai.running" && proposal.status === "queued") {
          proposal.status = "running";
          delete proposal.error;
        }
        if (
          action.type === "ai.ready" &&
          ["queued", "running"].includes(proposal.status)
        ) {
          proposal.steps = action.steps;
          proposal.status = "ready";
          delete proposal.error;
        }
        if (
          action.type === "ai.failed" &&
          ["queued", "running"].includes(proposal.status)
        ) {
          proposal.status = "failed";
          proposal.error = action.error;
        }
        if (action.type === "ai.edit" && proposal.status === "ready") {
          const step = proposal.steps.find((step) => step.id === action.stepId);
          if (step) Object.assign(step, action.fields);
        }
        if (
          action.type === "ai.add" &&
          proposal.status === "ready" &&
          !proposal.steps.some((step) => step.id === action.step.id)
        ) {
          proposal.steps.push(action.step);
        }
        if (action.type === "ai.remove" && proposal.status === "ready") {
          proposal.steps = proposal.steps.filter(
            (step) => step.id !== action.stepId,
          );
        }
        if (
          action.type === "ai.approve" &&
          proposal.status === "ready" &&
          proposal.steps.length
        ) {
          const parent = proposal.source.taskId
            ? tasks.get(proposal.source.taskId)
            : null;
          // Approval only adds children; it never replaces the source or existing work.
          if (
            proposal.source.taskId &&
            (!parent || parent.archived || parent.completed)
          )
            continue;
          const parentId = parent?.id ?? proposal.requestId;
          if (!parent && !tasks.has(parentId))
            tasks.set(parentId, {
              id: parentId,
              ...taskDefaults(proposal.source.title, {
                notes: proposal.source.notes,
                kind: "project",
                today: false,
                position: event.clock,
              }),
            });
          const position =
            Math.max(0, ...[...tasks.values()].map((task) => task.position)) +
            1;
          proposal.steps.forEach((step, index) => {
            if (!tasks.has(step.id))
              tasks.set(step.id, {
                ...taskDefaults(step.title, {
                  ...step,
                  parentId,
                  today: action.today,
                  position: position + index,
                }),
                id: step.id,
              });
          });
          proposal.status = "approved";
        }
      }
      continue;
    }
    if (action.type === "task.create") {
      if (!tasks.has(action.taskId))
        tasks.set(action.taskId, { id: action.taskId, ...action.fields });
    } else if (action.type === "task.edit") {
      const task = tasks.get(action.taskId);
      if (task) {
        if (
          ("scheduledDate" in action.fields ||
            "today" in action.fields ||
            "minutes" in action.fields) &&
          !("plannedStart" in action.fields)
        ) {
          task.plannedStart = null;
          task.plannedEnd = null;
        }
        Object.assign(task, action.fields);
      }
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
  // Also remove children created concurrently beneath a deleted parent.
  let cascade = true;
  while (cascade) {
    cascade = false;
    for (const task of tasks.values()) {
      if (
        gone("task", task.id) ||
        (task.parentId && gone("task", task.parentId))
      ) {
        mark("task", task.id);
        tasks.delete(task.id);
        cascade = true;
      }
    }
  }
  if (focus && !tasks.has(focus.taskId)) focus = null;
  for (const [id, proposal] of proposals) {
    if (
      gone("proposal", id) ||
      (proposal.source.taskId && gone("task", proposal.source.taskId)) ||
      gone("task", proposal.requestId)
    )
      proposals.delete(id);
  }
  for (const id of deleted.get("plan") ?? []) dailyPlans.delete(id);
  for (const id of deleted.get("contentRequest") ?? [])
    contentRequests.delete(id);
  for (const plan of dailyPlans.values())
    plan.blocks = plan.blocks.filter((block) => tasks.has(block.taskId));
  for (const calendar of calendars.values())
    calendar.events = calendar.events.filter(
      (event) => !gone("calendarEvent", calendar.id + ":" + event.id),
    );
  for (const [key, entry] of Object.entries(contentPicks))
    if (
      gone("entry", entry.id) ||
      [...(deleted.get("collection") ?? [])].some((id) =>
        key.startsWith(id + ":"),
      )
    )
      delete contentPicks[key];
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
    proposals: [...proposals.values()],
    planningSettings,
    calendars: [...calendars.values()],
    dailyPlans: [...dailyPlans.values()],
    briefingTemplate,
    briefingSchedule,
    weatherSnapshots,
    contentCollections: [...contentCollections.values()],
    contentRequests: [...contentRequests.values()],
    contentPicks,
    issuedBriefings,
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
