import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { getOptional: vi.fn(), execute: vi.fn() };
  return {
    tx,
    db: {
      disconnect: vi.fn(),
      connect: vi.fn(),
      writeTransaction: vi.fn(
        async (work: (transaction: typeof tx) => Promise<void>) => work(tx),
      ),
    },
    client: { query: vi.fn(), mutation: vi.fn() },
  };
});
vi.mock("../src/data/database", () => ({ db: mocks.db }));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    query = mocks.client.query;
    mutation = mocks.client.mutation;
  },
}));
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_POWERSYNC_URL", "https://sync.example");
  mocks.tx.getOptional.mockResolvedValue(null);
  mocks.client.query.mockResolvedValue({ id: "owner", label: "Owner" });
});
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllEnvs();
});
it("binds the local workspace to both account and deployment before connecting", async () => {
  const sync = await import("../src/data/sync");
  cleanup = sync.attachSync("token", true);
  await vi.waitFor(() => expect(mocks.db.connect).toHaveBeenCalledOnce());
  expect(mocks.tx.execute).toHaveBeenCalledWith(expect.any(String), [
    "account",
    "convex:https://test.convex.cloud:owner",
  ]);
  expect(sync.connectedClient()).toBe(sync.convex);
});
it("does not connect or overwrite an existing different account binding", async () => {
  mocks.tx.getOptional.mockResolvedValue({ value: "original-account" });
  const sync = await import("../src/data/sync");
  cleanup = sync.attachSync("token", true);
  await vi.waitFor(() => expect(mocks.tx.getOptional).toHaveBeenCalledOnce());
  expect(mocks.db.connect).not.toHaveBeenCalled();
  expect(mocks.tx.execute).not.toHaveBeenCalled();
  expect(() => sync.connectedClient()).toThrow("Connect your workspace");
});
it("ignores a late identity result after authentication cleanup", async () => {
  let resolveAccount!: (value: { id: string; label: string }) => void;
  mocks.client.query.mockReturnValue(
    new Promise((resolve) => {
      resolveAccount = resolve;
    }),
  );
  const sync = await import("../src/data/sync");
  cleanup = sync.attachSync("token", true);
  await vi.waitFor(() => expect(mocks.client.query).toHaveBeenCalledOnce());
  cleanup();
  cleanup = undefined;
  resolveAccount({ id: "owner", label: "Owner" });
  await vi.waitFor(() => expect(mocks.db.disconnect).toHaveBeenCalledTimes(2));
  expect(mocks.db.connect).not.toHaveBeenCalled();
  expect(mocks.tx.execute).not.toHaveBeenCalled();
});
it("uses the refreshed token expiration and rejects malformed credentials", async () => {
  const sync = await import("../src/data/sync");
  const token = `header.${btoa(JSON.stringify({ exp: 2000000000 }))}.signature`;
  const connector = new sync.Connector(sync.convex!, token);
  expect(await connector.fetchCredentials()).toEqual({
    endpoint: "https://sync.example",
    token,
    expiresAt: new Date(2000000000000),
  });
  await expect(
    new sync.Connector(sync.convex!, "malformed").fetchCredentials(),
  ).rejects.toThrow("invalid");
});
