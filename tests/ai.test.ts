import { describe, expect, it } from "vitest";
import {
  projectWorkspace,
  taskDefaults,
  type Action,
  type WorkspaceEvent,
} from "../src/domain/workspace";
const sourceId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const stepId = "10000000-0000-4000-8000-000000000003";
const source = {
  taskId: sourceId,
  title: "Portfolio",
  notes: "",
  doneWhen: "",
  existingSteps: [],
};
const step = {
  id: stepId,
  title: "Open the draft",
  notes: "",
  doneWhen: "Draft is open",
  minutes: 2,
};
const create: Action = {
  type: "task.create",
  taskId: sourceId,
  fields: taskDefaults("Portfolio"),
};
const request: Action = {
  type: "ai.request",
  requestId,
  mode: "breakdown",
  source,
};
const ready: Action = { type: "ai.ready", requestId, steps: [step] };
const approve: Action = { type: "ai.approve", requestId, today: true };
function events(actions: Action[]): WorkspaceEvent[] {
  return actions.map((action, i) => ({
    id: String(i),
    actor_id: "test",
    clock: i + 1,
    created_at: "2026-11-07T00:00:00Z",
    payload: JSON.stringify(action),
  }));
}
describe("AI drafts and approval", () => {
  it("never creates tasks from generation alone", () => {
    const state = projectWorkspace(events([create, request, ready]));
    expect(state.tasks).toHaveLength(1);
    expect(state.proposals[0].status).toBe("ready");
  });
  it("approves edited steps once and preserves concurrent source edits", () => {
    const state = projectWorkspace(
      events([
        create,
        request,
        ready,
        {
          type: "task.edit",
          taskId: sourceId,
          fields: { title: "Revised portfolio" },
        },
        { type: "ai.edit", requestId, stepId, fields: { title: "Open Figma" } },
        approve,
        approve,
      ]),
    );
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.find((task) => task.id === sourceId)?.title).toBe(
      "Revised portfolio",
    );
    expect(state.tasks.find((task) => task.id === stepId)?.title).toBe(
      "Open Figma",
    );
    expect(state.proposals[0].status).toBe("approved");
  });
  it("discards late results after cancellation", () => {
    const state = projectWorkspace(
      events([
        create,
        request,
        { type: "ai.cancel", requestId },
        ready,
        approve,
      ]),
    );
    expect(state.tasks).toHaveLength(1);
    expect(state.proposals[0].status).toBe("canceled");
  });
  it("does not approve an empty draft or attach children to an archived task", () => {
    for (const action of [
      { type: "ai.remove", requestId, stepId },
      { type: "task.edit", taskId: sourceId, fields: { archived: true } },
    ] as Action[]) {
      expect(
        projectWorkspace(events([create, request, ready, action, approve]))
          .tasks,
      ).toHaveLength(1);
    }
  });
  it("creates a project only after a new goal is approved", () => {
    const state = projectWorkspace(
      events([
        { ...request, source: { ...source, taskId: null } },
        ready,
        { ...approve, today: false },
      ]),
    );
    expect(state.tasks.find((task) => task.id === requestId)?.kind).toBe(
      "project",
    );
    expect(state.tasks.find((task) => task.id === stepId)).toMatchObject({
      parentId: requestId,
      today: false,
    });
  });
  it("converges on event replay and keeps requests while waiting for configuration", () => {
    const input = events([
      create,
      request,
      { type: "ai.running", requestId },
      { type: "ai.waiting", requestId, error: "Waiting for key" },
    ]);
    expect(projectWorkspace([...input].reverse())).toEqual(
      projectWorkspace(input),
    );
    expect(projectWorkspace(input).proposals[0]).toMatchObject({
      status: "queued",
      error: "Waiting for key",
    });
  });
});

it("manual draft steps wait for approval, preserve order, and replay once", () => {
  const manual = { ...step, id: "10000000-0000-4000-8000-000000000004", title: "Ask a peer to review" };
  const add: Action = { type: "ai.add", requestId, step: manual };
  const pending = projectWorkspace(events([create, request, ready, add, add]));
  expect(pending.tasks).toHaveLength(1);
  expect(pending.proposals[0].steps.map(s => s.id)).toEqual([stepId, manual.id]);
  const approved = projectWorkspace(events([create, request, ready, add, approve, add]));
  expect(approved.tasks.filter(t => t.parentId === sourceId).map(t => t.title)).toEqual([step.title, manual.title]);
  expect(approved.tasks).toHaveLength(3);
});

it("ignores manual additions to drafts that are canceled or still generating", () => {
  const add: Action = { type: "ai.add", requestId, step };
  expect(projectWorkspace(events([request, add])).proposals[0].steps).toHaveLength(0);
  expect(projectWorkspace(events([request, ready, { type: "ai.cancel", requestId }, add])).proposals[0].steps).toHaveLength(1);
});
