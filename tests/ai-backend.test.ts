import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { projectWorkspace } from "../src/domain/workspace";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const requestId = "20000000-0000-4000-8000-000000000001";
const request = {
  type: "ai.request",
  requestId,
  mode: "breakdown",
  source: {
    taskId: null,
    title: "Portfolio",
    notes: "",
    doneWhen: "",
    existingSteps: [],
  },
};
const event = {
  id: "20000000-0000-4000-8000-000000000002",
  actor_id: "test",
  clock: 1,
  created_at: "2026-11-07T00:00:00Z",
  payload: JSON.stringify(request),
};
async function setup() {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email: "owner@example.com" });
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  return { t, owner: t.withIdentity({ subject: `${id}|session` }) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("AI backend", () => {
  it("deduplicates upload and rejects forged AI results", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setup();
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    expect(
      await t.run((ctx) => ctx.db.query("ai_jobs").collect()),
    ).toHaveLength(1);
    await expect(
      owner.mutation(api.workspace.appendEvents, {
        events: [
          {
            ...event,
            id: crypto.randomUUID(),
            payload: JSON.stringify({ type: "ai.running", requestId }),
          },
        ],
      }),
    ).rejects.toThrow("server");
    await expect(
      t.mutation(api.workspace.appendEvents, { events: [event] }),
    ).rejects.toThrow("access");
  });
  it("retains a missing-key request and resumes it after configuration", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "");
    const { t, owner } = await setup();
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    await t.finishInProgressScheduledFunctions();
    const id = await t.run(
      async (ctx) => (await ctx.db.query("ai_jobs").first())!._id,
    );
    // Explicit invocation also covers the claim guard when the scheduled action already ran.
    await t.action(internal.ai.generate, { id });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))!.status)).toBe(
      "waiting",
    );
    vi.stubEnv("OPENAI_API_KEY", "test-only-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      steps: [
                        {
                          title: "Open portfolio",
                          notes: "",
                          doneWhen: "The portfolio is open",
                          minutes: 2,
                        },
                      ],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    await t.action(internal.ai.resumeConfigured, {});
    await t.action(internal.ai.generate, { id });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))!.status)).toBe(
      "finished",
    );
    const data = await owner.query(api.workspace.bootstrapPage, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    const state = projectWorkspace(data.page);
    expect(state.proposals[0].status).toBe("ready");
    expect(state.tasks).toHaveLength(0);
  });
  it("ignores canceled results and stale timeout attempts", async () => {
    vi.useFakeTimers();
    const { t, owner } = await setup();
    await owner.mutation(api.workspace.appendEvents, { events: [event] });
    const id = await t.run(
      async (ctx) => (await ctx.db.query("ai_jobs").first())!._id,
    );
    await t.mutation(internal.aiJobs.claim, { id });
    await t.mutation(internal.aiJobs.expire, { id, attempt: 0 });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))!.status)).toBe(
      "running",
    );
    await owner.mutation(api.workspace.appendEvents, {
      events: [
        {
          ...event,
          id: crypto.randomUUID(),
          clock: 3,
          payload: JSON.stringify({ type: "ai.cancel", requestId }),
        },
      ],
    });
    await t.mutation(internal.aiJobs.finish, {
      id,
      attempt: 1,
      payload: JSON.stringify({
        type: "ai.failed",
        requestId,
        error: "Late failure",
      }),
    });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))!.status)).toBe(
      "canceled",
    );
  });
});

it("deleting an AI request cancels its queued worker job and ignores late results", async () => {
  vi.useFakeTimers();
  const { t, owner } = await setup();
  await owner.mutation(api.workspace.appendEvents, { events: [event] });
  const job = await t.run(
    async (ctx) => (await ctx.db.query("ai_jobs").first())!,
  );
  await owner.mutation(api.workspace.appendEvents, {
    events: [
      {
        ...event,
        id: crypto.randomUUID(),
        clock: 2,
        payload: JSON.stringify({
          type: "object.delete",
          kind: "proposal",
          id: requestId,
        }),
      },
    ],
  });
  expect(await t.mutation(internal.aiJobs.claim, { id: job._id })).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(job._id)))?.status).toBe("canceled");
  const data = await owner.query(api.workspace.bootstrapPage, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  expect(projectWorkspace(data.page).proposals).toHaveLength(0);
});
