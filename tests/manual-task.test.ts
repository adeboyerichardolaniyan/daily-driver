import { expect, it } from "vitest";
import { stepAfter } from "../src/domain/manual-task";
import { taskDefaults } from "../src/domain/workspace";
it("inserts a sibling between steps without changing its parent or scheduled date", () => {
  const first = { ...taskDefaults("First", { parentId: "plan", position: 10, today: false, scheduledDate: "2026-12-01" }), id: "first" };
  const next = { ...first, id: "next", position: 11 };
  const fields = stepAfter(first, [next, first]);
  expect(fields).toEqual({ parentId: "plan", today: false, scheduledDate: "2026-12-01", position: 10.5 });
  expect(stepAfter(next, [next, first]).position).toBe(12);
});
