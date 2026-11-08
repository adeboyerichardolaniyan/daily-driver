import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
const root = resolve(".desktop-releases");
const manifestPath = resolve("public/updates/latest.json");
let raw: string | undefined;
try {
  raw = await readFile(manifestPath, "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (raw) {
  await mkdir(root, { recursive: true });
  const manifest = JSON.parse(raw) as {
    platforms: Record<string, { url: string; sha256: string }>;
  };
  for (const artifact of Object.values(manifest.platforms)) {
    const url = new URL(artifact.url);
    if (
      url.origin !== "https://daily-driver-liard.vercel.app" ||
      !/^\/updates\/daily-driver-[0-9A-Za-z.-]+\.app\.tar\.gz$/.test(
        url.pathname,
      ) ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    )
      throw new Error("Invalid desktop release artifact metadata.");
    const destination = resolve(root, basename(url.pathname));
    const digest = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    let existing: Buffer | undefined;
    try {
      existing = await readFile(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing) {
      if (digest(existing) !== artifact.sha256)
        throw new Error("Desktop artifact checksum mismatch.");
      continue;
    }
    // Keep the published desktop release present during ordinary web/CI builds.
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body)
      throw new Error("Could not restore the published desktop release.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 100_000_000)
        throw new Error("Desktop artifact exceeds size limit.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (digest(bytes) !== artifact.sha256)
      throw new Error("Downloaded desktop artifact checksum mismatch.");
    await writeFile(destination, bytes);
  }
}
