import { expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { projectWorkspace } from "../src/domain/workspace";
vi.mock("@convex-dev/agent", () => ({
  Agent: class {
    async createThread() {
      return {
        thread: {
          generateObject: async () => ({
            object: {
              entries: [
                {
                  text: "Take the next small step with patience.",
                  reference: "Psalm 23:1",
                },
              ],
            },
          }),
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
it("generates unapproved Bible reflections and rejects forged server results", async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const t = convexTest(schema, modules);
  const user = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {});
    await ctx.db.insert("app_members", { user_id: id });
    return id;
  });
  const owner = t.withIdentity({ subject: `${user}|session` });
  const collection = {
    id: crypto.randomUUID(),
    name: "Scripture",
    kind: "bible",
    tone: "Gentle",
    theme: "Patience",
    translation: "EasyEnglish (EASY)",
  };
  const requestId = crypto.randomUUID();
  const events = [
    { type: "content.collection", collection },
    { type: "content.request", requestId, collection, count: 1 },
  ].map((a, i) => ({
    id: crypto.randomUUID(),
    actor_id: "test",
    clock: i + 1,
    created_at: new Date().toISOString(),
    payload: JSON.stringify(a),
  }));
  await owner.mutation(api.workspace.appendEvents, { events });
  const job = await t.run((ctx) => ctx.db.query("content_jobs").first());
  await t.action(internal.contentAI.generate, { id: job!._id });
  const history = await t.run((ctx) =>
    ctx.db.query("workspace_events").collect(),
  );
  const state = projectWorkspace(history.map((e) => ({ ...e, id: e.uuid })));
  expect(state.contentCollections[0].entries[0]).toMatchObject({
    approved: false,
    origin: "scripture-reflection",
    translation: "EasyEnglish (EASY)",
    attribution: "Psalm 23:1",
  });
  expect(state.contentRequests[0].status).toBe("ready");
  await expect(
    owner.mutation(api.workspace.appendEvents, {
      events: [
        {
          ...events[0],
          id: crypto.randomUUID(),
          clock: 20,
          payload: JSON.stringify({
            type: "content.result",
            requestId,
            status: "ready",
            entries: [],
            message: "Forged",
          }),
        },
      ],
    }),
  ).rejects.toThrow("only be written by the server");
});
it("waits for a missing key and ignores obsolete worker completions", async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "");
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", {});
    return ctx.db.insert("content_jobs", {
      request_id: crypto.randomUUID(),
      owner_id: user,
      request: JSON.stringify({
        type: "content.request",
        requestId: crypto.randomUUID(),
        count: 1,
        collection: {
          id: crypto.randomUUID(),
          name: "Notes",
          kind: "quotes",
          tone: "Gentle",
          theme: "",
          translation: "",
        },
      }),
      attempt: 0,
      status: "queued",
    });
  });
  // Use matching request identities, as upload does.
  await t.run(async (ctx) => {
    const job = await ctx.db.get(id);
    const request = JSON.parse(job!.request);
    request.requestId = job!.request_id;
    await ctx.db.patch(id, { request: JSON.stringify(request) });
  });
  await t.action(internal.contentAI.generate, { id });
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("waiting");
  await t.mutation(internal.contentJobs.finish, {
    id,
    attempt: 0,
    payload: "invalid",
  });
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("waiting");
});
