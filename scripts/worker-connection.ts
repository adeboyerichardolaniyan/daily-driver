import { ConvexHttpClient } from "convex/browser";
export function workerConnection(
  env: Record<string, string | undefined> = process.env,
) {
  const raw = env.CONVEX_URL?.trim();
  if (!raw) throw new Error("Missing CONVEX_URL in .env.worker.");
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "CONVEX_URL must be the deployment origin, without credentials, paths or query parameters.",
    );
  if (url.hostname.endsWith(".convex.site"))
    throw new Error("Use the .convex.cloud deployment URL, not .convex.site.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  )
    throw new Error("CONVEX_URL requires HTTPS, except local development.");
  const secret = env.PRINT_WORKER_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "PRINT_WORKER_SECRET must contain at least 32 characters and match the Convex development environment.",
    );
  const client = new ConvexHttpClient(url.origin, {
    logger: false,
    fetch: async (input, init) => {
      let response: Response;
      try {
        response = await fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(20000),
        });
      } catch {
        throw new Error(
          `Could not reach ${url.hostname}. Check internet access, DNS, VPN/proxy settings and CONVEX_URL.`,
        );
      }
      if (!response.ok && response.status !== 560) {
        // Never log request bodies or arbitrary response bodies: they can contain credentials.
        throw new Error(
          `Convex returned HTTP ${response.status} from ${url.hostname}. Check the deployment URL and any VPN/proxy. HTTP 401/403 may indicate access is blocked.`,
        );
      }
      return response;
    },
  });
  return {
    client,
    secret,
    url: url.origin,
    worker: env.WORKER_ID || "workstation-mac-mini",
  };
}
export function connectionMessage(error: unknown, secret?: string) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Convex returned an empty error. Run npm run print:diagnose.";
  return secret ? message.split(secret).join("[redacted]") : message;
}
