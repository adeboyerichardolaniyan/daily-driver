import { describe, expect, it } from "vitest";
import {
  projectWorkspace,
  taskDefaults,
  type Action,
  type WorkspaceEvent,
} from "../src/domain/workspace";
const id = () => crypto.randomUUID();
function events(actions: Action[]): WorkspaceEvent[] {
  return actions.map((a, i) => ({
    id: id(),
    actor_id: "a",
    clock: i + 1,
    created_at: "2026-11-07T12:00:00Z",
    payload: JSON.stringify(a),
  }));
}
describe("synced object deletion", () => {
  it("deletes a project, nested work and focus despite stale edits or late children", () => {
    const root = id(),
      child = id(),
      late = id(),
      session = id(),
      sibling = id();
    const log = events([
      {
        type: "task.create",
        taskId: root,
        fields: taskDefaults("Project", { kind: "project" }),
      },
      {
        type: "task.create",
        taskId: child,
        fields: taskDefaults("Child", { parentId: root }),
      },
      { type: "task.create", taskId: sibling, fields: taskDefaults("Keep") },
      { type: "focus.start", taskId: child, sessionId: session, at: 1 },
      { type: "object.delete", kind: "task", id: root, relatedIds: [child] },
      {
        type: "task.edit",
        taskId: child,
        fields: { title: "Stale offline edit", parentId: null },
      },
      {
        type: "task.create",
        taskId: late,
        fields: taskDefaults("Late child", { parentId: root }),
      },
    ]);
    const state = projectWorkspace(log);
    expect(state.tasks.map((t) => t.id)).toEqual([sibling]);
    expect(state.focus).toBeNull();
    expect(projectWorkspace([...log].reverse())).toEqual(state);
  });
  it("keeps children moved out before deleting their former parent", () => {
    const root = id(),
      child = id();
    const state = projectWorkspace(
      events([
        {
          type: "task.create",
          taskId: root,
          fields: taskDefaults("Project", { kind: "project" }),
        },
        {
          type: "task.create",
          taskId: child,
          fields: taskDefaults("Independent", { parentId: root }),
        },
        { type: "task.edit", taskId: child, fields: { parentId: null } },
        { type: "object.delete", kind: "task", id: root },
      ]),
    );
    expect(state.tasks.map((t) => t.id)).toEqual([child]);
  });
  it("removes approved AI history without removing its approved tasks", () => {
    const requestId = id(),
      step = id();
    const state = projectWorkspace(
      events([
        {
          type: "ai.request",
          requestId,
          mode: "breakdown",
          source: {
            taskId: null,
            title: "Project",
            notes: "",
            doneWhen: "",
            existingSteps: [],
          },
        },
        {
          type: "ai.ready",
          requestId,
          steps: [
            {
              id: step,
              title: "Step",
              notes: "",
              doneWhen: "Done",
              minutes: 2,
            },
          ],
        },
        { type: "ai.approve", requestId, today: true },
        { type: "object.delete", kind: "proposal", id: requestId },
        {
          type: "ai.ready",
          requestId,
          steps: [
            {
              id: id(),
              title: "Late",
              notes: "",
              doneWhen: "Done",
              minutes: 2,
            },
          ],
        },
      ]),
    );
    expect(state.proposals).toHaveLength(0);
    expect(state.tasks.map((t) => t.id)).toEqual([requestId, step]);
  });
  it("keeps deleted collections and entries deleted after offline edits and AI results", () => {
    const collection = {
      id: id(),
      name: "Quotes",
      kind: "quotes" as const,
      tone: "Warm",
      theme: "",
      translation: "",
    };
    const entry = {
      id: id(),
      text: "Hello",
      attribution: "",
      source: "",
      translation: "",
      origin: "personal" as const,
      approved: true,
    };
    const log = events([
      { type: "content.collection", collection },
      { type: "content.entry", collectionId: collection.id, entry },
      {
        type: "content.removeEntry",
        collectionId: collection.id,
        entryId: entry.id,
      },
      {
        type: "content.entry",
        collectionId: collection.id,
        entry: { ...entry, text: "Stale" },
      },
    ]);
    expect(projectWorkspace(log).contentCollections[0].entries).toHaveLength(0);
    const more = events([
      { type: "content.removeCollection", collectionId: collection.id },
      { type: "content.collection", collection },
    ]).map((e, i) => ({ ...e, clock: log.length + i + 1 }));
    expect(projectWorkspace([...log, ...more]).contentCollections).toHaveLength(
      0,
    );
  });
  it("deletes a saved receipt but allows an explicit new save for that date", () => {
    const date = "2026-11-07",
      snapshot = { version: 1 as const, title: "Original", date, tasks: [] };
    const log = events([
      { type: "briefing.issue", date, snapshot },
      { type: "object.delete", kind: "briefing", id: date },
    ]);
    expect(projectWorkspace(log).issuedBriefings[date]).toBeUndefined();
    log.push({
      ...events([
        {
          type: "briefing.issue",
          date,
          snapshot: { ...snapshot, title: "New" },
        },
      ])[0],
      clock: 3,
    });
    expect(projectWorkspace(log).issuedBriefings[date].title).toBe("New");
  });
  it("does not revive removed imported calendar occurrences after refresh", () => {
    const source = {
      id: "calendar",
      name: "Calendar",
      events: [
        {
          id: "occurrence",
          title: "Call",
          start: 1,
          end: 2,
          allDay: false,
          busy: true,
        },
      ],
      refreshedAt: 1,
      error: null,
      rangeStart: 0,
      rangeEnd: 3,
    };
    const state = projectWorkspace(
      events([
        { type: "calendar.snapshot", source },
        {
          type: "object.delete",
          kind: "calendarEvent",
          id: "calendar:occurrence",
        },
        { type: "calendar.snapshot", source: { ...source, refreshedAt: 2 } },
      ]),
    );
    expect(state.calendars[0].events).toHaveLength(0);
  });
});
