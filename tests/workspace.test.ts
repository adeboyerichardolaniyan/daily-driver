import { describe, expect, it } from "vitest";
import {
  projectWorkspace,
  taskDefaults,
  elapsed,
  type Action,
  type WorkspaceEvent,
} from "../src/domain/workspace";
const taskId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
let id = 0;
function event(clock: number, action: Action, actor = "a"): WorkspaceEvent {
  return {
    id: String(++id),
    actor_id: actor,
    clock,
    created_at: new Date().toISOString(),
    payload: JSON.stringify(action),
  };
}
const create = () =>
  event(1, {
    type: "task.create",
    taskId,
    fields: taskDefaults("Open the case study"),
  });
describe("offline event reconciliation", () => {
  it("converges in either delivery order and deduplicates retries", () => {
    const first = create();
    const a = event(
      2,
      { type: "task.edit", taskId, fields: { title: "Revised title" } },
      "a",
    );
    const b = event(
      2,
      { type: "task.edit", taskId, fields: { notes: "Offline notes" } },
      "b",
    );
    const left = projectWorkspace([b, first, a, b]);
    const right = projectWorkspace([first, a, b]);
    expect(left).toEqual(right);
    expect(left.tasks[0]).toMatchObject({
      title: "Revised title",
      notes: "Offline notes",
    });
  });
  it("keeps both versions when concurrent edits touch the same field", () => {
    const a = event(
      2,
      { type: "task.edit", taskId, fields: { title: "Laptop A" } },
      "a",
    );
    const b = event(
      2,
      { type: "task.edit", taskId, fields: { title: "Laptop B" } },
      "b",
    );
    const state = projectWorkspace([b, create(), a]);
    expect(state.tasks[0].title).toBe("Laptop B");
    expect(state.events).toContain(a);
    expect(state.events).toContain(b);
  });
  it("does not undo completion when a description was edited offline", () => {
    const state = projectWorkspace([
      create(),
      event(2, { type: "task.edit", taskId, fields: { completed: true } }),
      event(3, {
        type: "task.edit",
        taskId,
        fields: { notes: "Still retained" },
      }),
    ]);
    expect(state.tasks[0]).toMatchObject({
      completed: true,
      notes: "Still retained",
    });
  });
  it("breaks parent cycles without losing the task or its original history", () => {
    const state = projectWorkspace([
      create(),
      event(2, {
        type: "task.create",
        taskId: otherId,
        fields: taskDefaults("Child", { parentId: taskId }),
      }),
      event(3, { type: "task.edit", taskId, fields: { parentId: otherId } }),
    ]);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks.find((t) => t.id === taskId)?.parentId).toBeNull();
    expect(state.events).toHaveLength(3);
  });
  it("skips malformed events visibly", () => {
    expect(
      projectWorkspace([{ ...create(), payload: "{broken" }]).invalidCount,
    ).toBe(1);
  });
});
describe("focus continuity", () => {
  it("uses timestamps, excludes pauses, and does not count duplicate resumes", () => {
    const state = projectWorkspace([
      create(),
      event(2, { type: "focus.start", taskId, sessionId, at: 1000 }),
      event(3, { type: "focus.pause", sessionId, at: 11000 }),
      event(4, { type: "focus.resume", sessionId, at: 20000 }),
      event(5, { type: "focus.resume", sessionId, at: 21000 }),
    ]);
    expect(elapsed(state.focus, 25000)).toBe(15000);
  });
  it("ignores delayed actions on an older session after switching", () => {
    const secondSession = "00000000-0000-4000-8000-000000000004";
    const state = projectWorkspace([
      create(),
      event(2, { type: "focus.start", taskId, sessionId, at: 1000 }),
      event(3, {
        type: "focus.start",
        taskId,
        sessionId: secondSession,
        at: 5000,
      }),
      event(4, { type: "focus.stop", sessionId, at: 7000 }),
    ]);
    expect(state.focus?.sessionId).toBe(secondSession);
    expect(elapsed(state.focus, 10000)).toBe(5000);
  });
});
