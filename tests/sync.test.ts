import { describe, expect, it, vi } from "vitest";
import {
  Replicator,
  type SyncStore,
  type SyncTransport,
} from "../src/data/replicator";
import type { WorkspaceEvent } from "../src/domain/workspace";
const event: WorkspaceEvent = {
  id: "event",
  actor_id: "laptop",
  clock: 1,
  created_at: "2026-11-07T00:00:00Z",
  payload: "{}",
};
function fixture() {
  const settings = new Map<string, string>();
  const pending: WorkspaceEvent[] = [event];
  const received: WorkspaceEvent[] = [];
  const store: SyncStore = {
    setting: async (key) => settings.get(key) ?? null,
    pending: async () => [...pending],
    acknowledge: async (events) => {
      events.forEach((e) =>
        pending.splice(
          pending.findIndex((p) => p.id === e.id),
          1,
        ),
      );
    },
    receive: async (events, checkpoint) => {
      received.push(...events);
      if (checkpoint) settings.set(checkpoint.key, checkpoint.value);
    },
  };
  const transport: SyncTransport = {
    bootstrap: vi.fn(async () => ({
      page: [],
      continueCursor: "",
      isDone: true,
    })),
    upload: vi.fn(async () => null),
    changes: vi.fn(async () => []),
  };
  const report = vi.fn();
  const replicator = new Replicator(store, transport, report);
  return { settings, pending, received, store, transport, report, replicator };
}
describe("durable direct sync", () => {
  it("retains an upload after network failure and retries it", async () => {
    const f = fixture();
    vi.mocked(f.transport.upload).mockRejectedValueOnce(new Error("offline"));
    await f.replicator.request();
    expect(f.pending).toEqual([event]);
    expect(f.report).toHaveBeenLastCalledWith("offline");
    await f.replicator.request();
    expect(f.pending).toEqual([]);
    expect(f.transport.upload).toHaveBeenCalledTimes(2);
    expect(f.report).toHaveBeenLastCalledWith(null);
  });
  it("resumes interrupted bootstrap from its durable cursor", async () => {
    const f = fixture();
    vi.mocked(f.transport.bootstrap)
      .mockResolvedValueOnce({
        page: [event],
        continueCursor: "page-two",
        isDone: false,
      })
      .mockRejectedValueOnce(new Error("offline"));
    await f.replicator.request();
    expect(f.settings.get("direct_bootstrap")).toBe("page-two");
    await f.replicator.request();
    expect(f.transport.bootstrap).toHaveBeenLastCalledWith("page-two");
    expect(f.settings.get("direct_bootstrap")).toBe("done");
  });
  it("downloads later pages using committed sequence cursors", async () => {
    const f = fixture();
    f.settings.set("direct_bootstrap", "done");
    vi.mocked(f.transport.changes)
      .mockResolvedValueOnce([{ ...event, sequence: 20 }])
      .mockResolvedValueOnce([{ ...event, id: "next", sequence: 21 }]);
    await f.replicator.request();
    expect(f.transport.changes).toHaveBeenNthCalledWith(1, 0);
    expect(f.transport.changes).toHaveBeenNthCalledWith(2, 20);
    expect(f.transport.changes).toHaveBeenNthCalledWith(3, 21);
    expect(f.settings.get("direct_cursor")).toBe("21");
    expect(f.transport.bootstrap).not.toHaveBeenCalled();
  });
  it("does not advance the cursor when local persistence fails", async () => {
    const f = fixture();
    f.settings.set("direct_bootstrap", "done");
    vi.mocked(f.transport.changes).mockResolvedValue([
      { ...event, sequence: 1 },
    ]);
    f.store.receive = async () => {
      throw new Error("disk full");
    };
    await f.replicator.request();
    expect(f.settings.has("direct_cursor")).toBe(false);
    expect(f.report).toHaveBeenLastCalledWith("disk full");
  });
  it("ignores an in-flight download after cleanup", async () => {
    const f = fixture();
    let finish!: (v: {
      page: WorkspaceEvent[];
      continueCursor: string;
      isDone: boolean;
    }) => void;
    vi.mocked(f.transport.bootstrap).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = f.replicator.request();
    await vi.waitFor(() => expect(f.transport.bootstrap).toHaveBeenCalled());
    f.replicator.stop();
    finish({ page: [event], continueCursor: "", isDone: true });
    await running;
    expect(f.received).toEqual([]);
    expect(f.transport.upload).not.toHaveBeenCalled();
    expect(f.settings.size).toBe(0);
  });
});
