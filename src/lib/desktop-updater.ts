export type UpdateState = {
  phase: "idle" | "checking" | "available" | "installing" | "ready" | "error";
  version?: string;
  notes?: string;
  percent?: number;
  message?: string;
};
export interface UpdatePackage {
  version: string;
  body?: string;
  downloadAndInstall(
    callback: (
      event:
        | { event: "Started"; data: { contentLength?: number } }
        | { event: "Progress"; data: { chunkLength: number } }
        | { event: "Finished" },
    ) => void,
    options?: { timeout: number },
  ): Promise<void>;
  close(): Promise<void>;
}
function updateFailure(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/no such file|not found|os error 2\b/i.test(detail)) {
    return "Quit Daily Driver completely, reopen it from Applications, then check again. Its install location may have changed.";
  }
  if (/permission|read-only|os error (1|13|30)\b/i.test(detail)) {
    return "Move Daily Driver to Applications, quit and reopen it there, then retry. macOS may ask for permission to replace the app.";
  }
  if (/timed? ?out|timeout/i.test(detail)) {
    return "The download timed out. Check your connection and try again.";
  }
  return detail
    ? `Update failed: ${detail.slice(0, 500)}`
    : "The update couldn’t be installed. Check again to retry.";
}
export class DesktopUpdater {
  private state: UpdateState = { phase: "idle" };
  private update: UpdatePackage | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private driver: {
      check(): Promise<UpdatePackage | null>;
      restart(): Promise<void>;
    },
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: UpdateState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  async check() {
    if (["checking", "installing", "ready"].includes(this.state.phase)) return;
    this.publish({ phase: "checking" });
    try {
      await this.update?.close();
      this.update = null;
      this.update = await this.driver.check();
      this.publish(
        this.update
          ? {
              phase: "available",
              version: this.update.version,
              notes: this.update.body,
            }
          : { phase: "idle", message: "You’re up to date." },
      );
    } catch {
      this.publish({
        phase: "error",
        message:
          "Couldn’t check for updates. Check your connection and try again.",
      });
    }
  }
  async install() {
    if (this.state.phase !== "available" || !this.update) return;
    const update = this.update;
    this.publish({ ...this.state, phase: "installing", percent: undefined });
    let received = 0;
    let total = 0;
    try {
      await update.downloadAndInstall(
        (event) => {
          if (event.event === "Started") total = event.data.contentLength ?? 0;
          if (event.event === "Progress") received += event.data.chunkLength;
          this.publish({
            ...this.state,
            percent: total
              ? Math.min(100, Math.round((received / total) * 100))
              : undefined,
          });
        },
        { timeout: 120000 },
      );
      this.publish({
        phase: "ready",
        version: update.version,
        message: "Update installed. Restart when you’re ready.",
      });
    } catch (error) {
      this.publish({
        phase: "error",
        message: updateFailure(error),
      });
    } finally {
      this.update = null;
      await update.close().catch(() => {});
    }
  }
  async restart() {
    if (this.state.phase !== "ready") return;
    try {
      await this.driver.restart();
    } catch {
      this.publish({
        ...this.state,
        message: "Quit and reopen Daily Driver to finish updating.",
      });
    }
  }
}
export const desktopUpdater = new DesktopUpdater({
  check: async () =>
    (await import("@tauri-apps/plugin-updater")).check({ timeout: 15000 }),
  restart: async () => (await import("@tauri-apps/plugin-process")).relaunch(),
});
