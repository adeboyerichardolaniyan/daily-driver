import { afterEach, expect, it, vi } from "vitest";
import {
  workerConnection,
  connectionMessage,
} from "../scripts/worker-connection";
import { api } from "../convex/_generated/api";
const env = {
  CONVEX_URL: "https://example.convex.cloud/",
  PRINT_WORKER_SECRET: "x".repeat(32),
};
afterEach(() => vi.unstubAllGlobals());
it("rejects endpoint mistakes without exposing credentials", () => {
  expect(workerConnection(env).url).toBe("https://example.convex.cloud");
  expect(() =>
    workerConnection({ ...env, CONVEX_URL: "https://example.convex.site" }),
  ).toThrow(".convex.cloud");
  expect(() =>
    workerConnection({
      ...env,
      CONVEX_URL: "https://example.convex.cloud/api/query",
    }),
  ).toThrow("origin");
  expect(
    connectionMessage(
      new Error(env.PRINT_WORKER_SECRET),
      env.PRINT_WORKER_SECRET,
    ),
  ).toBe("[redacted]");
});
it("includes the HTTP status when an upstream returns an empty error body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 403 })),
  );
  const { client, secret, worker } = workerConnection(env);
  await expect(
    client.query(api.printing.interrupted, { secret, worker }),
  ).rejects.toThrow("HTTP 403");
});
