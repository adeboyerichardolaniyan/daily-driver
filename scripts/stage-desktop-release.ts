import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
// Tauri invokes the same web build; never embed update archives inside an app.
if (!process.env.TAURI_ENV_PLATFORM) {
  const manifest = resolve("public/updates/latest.json");
  let exists = true;
  try {
    await access(manifest);
  } catch {
    exists = false;
  }
  if (exists) {
    const data = JSON.parse(await readFile(manifest, "utf8")) as {
      platforms: Record<string, { url: string }>;
    };
    await mkdir("dist/updates", { recursive: true });
    for (const artifact of Object.values(data.platforms)) {
      const filename = basename(new URL(artifact.url).pathname);
      await copyFile(
        resolve(".desktop-releases", filename),
        resolve("dist/updates", filename),
      );
    }
  }
}
