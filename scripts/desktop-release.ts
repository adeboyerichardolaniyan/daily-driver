import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error(
    "This release command currently builds Apple Silicon macOS packages.",
  );
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (config.version !== pkg.version)
  throw new Error("Align package and Tauri versions before releasing.");
const key =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  resolve(homedir(), ".config/daily-driver/updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) await access(key);
const notesFile = process.argv[2];
if (!notesFile)
  throw new Error("Usage: npm run desktop:release -- <release-notes-file>");
const notes = await readFile(notesFile, "utf8");
const run = (command: string, args: string[], env = process.env) =>
  new Promise<void>((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(command + " failed: " + code)),
    );
  });
await run("npm", ["run", "tauri", "--", "build", "--bundles", "app"], {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "",
});
const bundle = resolve("src-tauri/target/release/bundle/macos");
await run("codesign", [
  "--verify",
  "--deep",
  "--strict",
  resolve(bundle, "Daily Driver.app"),
]);
const archive = resolve(bundle, "Daily Driver.app.tar.gz");
const bytes = await readFile(archive);
const signature = (await readFile(archive + ".sig", "utf8")).trim();
if (!signature) throw new Error("Missing update signature.");
const directory = resolve("public/updates");
await mkdir(directory, { recursive: true });
const filename = `daily-driver-${config.version}-aarch64.app.tar.gz`;
const cache = resolve(".desktop-releases");
await mkdir(cache, { recursive: true });
await copyFile(archive, resolve(cache, filename));
await writeFile(
  resolve(directory, "latest.json"),
  JSON.stringify(
    {
      version: config.version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": {
          url: "https://daily-driver-liard.vercel.app/updates/" + filename,
          signature,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    },
    null,
    2,
  ) + "\n",
);
const zip = resolve(bundle, `Daily-Driver-${config.version}-Apple-Silicon.zip`);
await run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  resolve(bundle, "Daily Driver.app"),
  zip,
]);
console.log(
  "Signed release prepared. Deploy the web app to publish the update feed.",
);
console.log("First-install ZIP: " + zip);
