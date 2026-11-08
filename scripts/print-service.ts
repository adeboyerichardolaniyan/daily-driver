import { mkdir, writeFile, access, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
process.umask(0o077);
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const label = "com.dailydriver.print-worker";
const destination = resolve(
  homedir(),
  "Library/LaunchAgents",
  `${label}.plist`,
);
const domain = `gui/${process.getuid!()}`;
const command = process.argv[2] || "prepare";
if (process.platform !== "darwin")
  throw new Error("This startup service requires macOS.");
if (command === "stop") {
  await execute("/bin/launchctl", ["bootout", `${domain}/${label}`]);
  console.log("Worker stopped. The startup plist remains installed.");
} else {
  if (!["prepare", "install"].includes(command))
    throw new Error("Use prepare, install, or stop.");
  const logs = resolve(homedir(), "Library/Logs/DailyDriver");
  await mkdir(logs, { recursive: true, mode: 0o700 });
  await chmod(logs, 0o700);
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const args = [
    process.execPath,
    `--env-file=${resolve(root, ".env.worker")}`,
    "--import",
    "tsx",
    resolve(root, "scripts/print-worker.ts"),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((a) => `<string>${escape(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>Umask</key><integer>63</integer>
<key>ThrottleInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>${escape(resolve(logs, "worker.log"))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(logs, "worker-error.log"))}</string>
</dict></plist>`;
  const path =
    command === "install"
      ? destination
      : resolve(root, ".print-worker", `${label}.plist`);
  await mkdir(resolve(root, ".print-worker"), { recursive: true, mode: 0o700 });
  if (command === "install") {
    await access(resolve(root, ".env.worker"));
    await chmod(resolve(root, ".env.worker"), 0o600);
    await mkdir(resolve(homedir(), "Library/LaunchAgents"), {
      recursive: true,
    });
    try {
      await execute("/bin/launchctl", ["print", `${domain}/${label}`]);
      throw new Error(
        "Worker already loaded. Run npm run print:service -- stop before reinstalling.",
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Worker already"))
        throw error;
    }
  }
  await writeFile(path, xml, { mode: 0o600 });
  await execute("/usr/bin/plutil", ["-lint", path]);
  if (command === "install")
    await execute("/bin/launchctl", ["bootstrap", domain, path]);
  console.log(
    `${command === "install" ? "Installed" : "Prepared (not installed)"}: ${path}`,
  );
}
