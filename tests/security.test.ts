import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { calendarFeedUrl } from "../src/domain/feed-url";
import { receiptFilePath } from "../scripts/printer-output";
import { renderReceipt } from "../src/domain/receipt";
const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "test-worker-secret-".repeat(3);
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  vi.stubEnv("PRINT_WORKER_SECRET", secret);
  const t = convexTest(schema, modules);
  const [ownerId, strangerId] = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "owner@example.com" });
    const stranger = await ctx.db.insert("users", {
      email: "stranger@example.com",
    });
    await ctx.db.insert("app_members", { user_id: owner });
    return [owner, stranger];
  });
  return {
    t,
    owner: t.withIdentity({ subject: ownerId + "|session" }),
    stranger: t.withIdentity({ subject: strangerId + "|session" }),
  };
}
describe("security boundaries", () => {
  it("denies anonymous and authenticated non-owner access", async () => {
    const { t, stranger } = await setup();
    for (const client of [t, stranger]) {
      await expect(client.query(api.workspace.account, {})).rejects.toThrow(
        "access",
      );
      await expect(client.query(api.workspace.head, {})).rejects.toThrow(
        "access",
      );
      await expect(
        client.query(api.workspace.changes, { after: 0 }),
      ).rejects.toThrow("access");
      await expect(
        client.query(api.workspace.bootstrapPage, {
          paginationOpts: { numItems: 10, cursor: null },
        }),
      ).rejects.toThrow("access");
      await expect(
        client.mutation(api.workspace.appendEvents, { events: [] }),
      ).rejects.toThrow("access");
      await expect(client.query(api.printing.list, {})).rejects.toThrow(
        "access",
      );
      await expect(
        client.mutation(api.printing.enqueue, {
          id: crypto.randomUUID(),
          snapshot: "{}",
        }),
      ).rejects.toThrow("access");
      await expect(
        client.mutation(api.calendars.add, {
          name: "Private",
          url: "https://calendar.google.com/test",
        }),
      ).rejects.toThrow("access");
      await expect(client.query(api.briefings.status, {})).rejects.toThrow(
        "access",
      );
    }
  });
  it("requires worker credentials, binds completion to claimant, and prevents replay", async () => {
    const { t, owner } = await setup();
    const id = crypto.randomUUID();
    const snapshot = JSON.stringify({
      version: 1,
      title: "Test",
      date: "Today",
      tasks: [],
    });
    await owner.mutation(api.printing.enqueue, { id, snapshot });
    await expect(
      t.mutation(api.printing.claim, { secret: "wrong", worker: "mini" }),
    ).rejects.toThrow("authentication");
    expect(
      await t.mutation(api.printing.claim, {
        secret,
        worker: "mini",
        output: "pdf",
      }),
    ).toBeNull();
    expect(
      await t.mutation(api.printing.claim, {
        secret,
        worker: "mini",
        output: "printer",
      }),
    ).not.toBeNull();
    expect(
      await t.mutation(api.printing.claim, { secret, worker: "other" }),
    ).toBeNull();
    await expect(
      t.mutation(api.printing.finish, {
        secret,
        worker: "other",
        id,
        outcome: "dispatched",
        detail: null,
      }),
    ).rejects.toThrow("assigned");
    await t.mutation(api.printing.finish, {
      secret,
      worker: "mini",
      id,
      outcome: "dispatched",
      detail: null,
    });
    await expect(
      t.mutation(api.printing.finish, {
        secret,
        worker: "mini",
        id,
        outcome: "failed",
        detail: null,
      }),
    ).rejects.toThrow("terminal");
    await owner.mutation(api.printing.enqueue, { id, snapshot });
    expect(
      await t.mutation(api.printing.claim, { secret, worker: "mini" }),
    ).toBeNull();
  });
  it("rejects oversized receipts before storing or rendering them", async () => {
    const { owner } = await setup();
    await expect(
      owner.mutation(api.printing.enqueue, {
        id: crypto.randomUUID(),
        snapshot: " ".repeat(500001),
      }),
    ).rejects.toThrow("too large");
  });
  it("rejects traversal and option-like job identifiers", () => {
    for (const id of ["../escape", "/tmp/escape", "--help", "a/b"]) {
      expect(() => receiptFilePath("/tmp/receipts", id, "pdf")).toThrow();
    }
    const id = crypto.randomUUID();
    expect(receiptFilePath("/tmp/receipts", id, "pdf")).toBe(
      "/tmp/receipts/" + id + ".pdf",
    );
  });
  it("rejects SSRF destinations and credentials disguised as calendar hosts", () => {
    for (const url of [
      "http://calendar.google.com/a",
      "https://127.0.0.1/a",
      "https://calendar.google.com.evil.example/a",
      "https://calendar.google.com@evil.example/a",
      "https://outlook.office.com:8443/a",
      "file:///etc/passwd",
    ]) {
      expect(() => calendarFeedUrl(url)).toThrow();
    }
    expect(calendarFeedUrl("webcal://calendar.google.com/a")).toBe(
      "https://calendar.google.com/a",
    );
  });
  it("escapes malicious receipt text without producing executable HTML", async () => {
    const html = await renderReceipt({
      version: 1,
      title: "<script>alert(1)</script>",
      date: "Today",
      tasks: [],
      closingLine: '<img src="https://evil.example/steal" onerror="alert(1)">',
      events: [{ title: "<iframe src='https://evil.example'>", time: "Now" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<img src="https://evil');
    expect(html).toContain("&lt;script&gt;");
  });
});

it("deleting a queued print job cancels it and prevents stale retries from reprinting", async () => {
  const { t, owner, stranger } = await setup();
  const id = crypto.randomUUID();
  const snapshot = JSON.stringify({
    version: 1,
    title: "Delete",
    date: "Today",
    tasks: [],
  });
  await owner.mutation(api.printing.enqueue, { id, snapshot });
  await expect(stranger.mutation(api.printing.remove, { id })).rejects.toThrow(
    "access",
  );
  await owner.mutation(api.printing.remove, { id });
  expect(await owner.query(api.printing.list, {})).toEqual([]);
  expect(
    await t.mutation(api.printing.claim, { secret, worker: "mini" }),
  ).toBeNull();
  await expect(
    owner.mutation(api.printing.enqueue, { id, snapshot }),
  ).rejects.toThrow("deleted");
});
it("does not delete a print job while the worker may be dispatching it", async () => {
  const { t, owner } = await setup();
  const id = crypto.randomUUID();
  await owner.mutation(api.printing.enqueue, {
    id,
    snapshot: JSON.stringify({
      version: 1,
      title: "Active",
      date: "Today",
      tasks: [],
    }),
  });
  await t.mutation(api.printing.claim, { secret, worker: "mini" });
  await expect(owner.mutation(api.printing.remove, { id })).rejects.toThrow(
    "being processed",
  );
  await t.mutation(api.printing.finish, {
    secret,
    worker: "mini",
    id,
    outcome: "rendered",
    detail: null,
  });
  await owner.mutation(api.printing.remove, { id });
  expect(await owner.query(api.printing.list, {})).toEqual([]);
});
