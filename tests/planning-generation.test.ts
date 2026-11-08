import { expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { taskDefaults, projectWorkspace } from "../src/domain/workspace";
import { defaultPlanningSettings } from "../src/domain/planning";
vi.mock("@convex-dev/agent", () => ({
  Agent: class {
    async createThread() {
      return {
        thread: {
          generateObject: async ({ prompt }: { prompt: string }) => {
            const data = JSON.parse(prompt);
            return {
              object: {
                tasks: data.tasks.map((t: { id: string }) => ({
                  taskId: t.id,
                  reason: "A manageable next step.",
                })),
                summary: "Start with these steps.",
              },
            };
          },
        },
      };
    }
  },
}));
const modules = import.meta.glob("../convex/**/*.{ts,js}");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("generates a reviewable plan through the agent without scheduling tasks", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T13:00:00Z"));
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const owner = t.withIdentity({ subject: `${userId}|session` });
  const planId = crypto.randomUUID(),
    taskId = crypto.randomUUID();
  const actions = [
    { type: "planning.settings", settings: defaultPlanningSettings() },
    { type: "task.create", taskId, fields: taskDefaults("Open the draft") },
    { type: "planning.request", planId, date: "2026-11-09" },
  ];
  await owner.mutation(api.workspace.appendEvents, {
    events: actions.map((a, i) => ({
      id: crypto.randomUUID(),
      actor_id: "test",
      clock: i + 1,
      created_at: new Date().toISOString(),
      payload: JSON.stringify(a),
    })),
  });
  const job = await t.run((ctx) => ctx.db.query("planning_jobs").first());
  await t.action(internal.planningAI.generate, { id: job!._id });
  const history = await t.run((ctx) =>
    ctx.db.query("workspace_events").collect(),
  );
  const state = projectWorkspace(history.map((e) => ({ ...e, id: e.uuid })));
  expect(state.dailyPlans[0].status).toBe("ready");
  expect(state.dailyPlans[0].blocks.map((b) => b.taskId)).toEqual([taskId]);
  expect(state.tasks[0].scheduledDate).toBeUndefined();
});
