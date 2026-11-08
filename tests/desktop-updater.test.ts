import { describe, expect, it, vi } from "vitest";
import { DesktopUpdater, type UpdatePackage } from "../src/lib/desktop-updater";

function setup() {
  const update: UpdatePackage = {
    version: "0.3.0",
    body: "Improvements",
    downloadAndInstall: vi.fn(async (callback) => {
      callback({ event: "Started", data: { contentLength: 100 } });
      callback({ event: "Progress", data: { chunkLength: 50 } });
      callback({ event: "Finished" });
    }),
    close: vi.fn(async () => {}),
  };
  const driver = {
    check: vi.fn(async (): Promise<UpdatePackage | null> => update),
    restart: vi.fn(async () => {}),
  };
  return { update, driver, controller: new DesktopUpdater(driver) };
}
describe("desktop updates", () => {
  it("checks without installing, then requires an explicit restart", async () => {
    const { update, driver, controller } = setup();
    await controller.check();
    expect(controller.snapshot().phase).toBe("available");
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    const phases: string[] = [];
    const unsubscribe = controller.subscribe(() =>
      phases.push(controller.snapshot().phase),
    );
    await controller.install();
    expect(update.downloadAndInstall).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 120000 },
    );
    expect(phases).toContain("installing");
    expect(controller.snapshot().phase).toBe("ready");
    expect(update.close).toHaveBeenCalledOnce();
    expect(driver.restart).not.toHaveBeenCalled();
    await controller.check();
    expect(driver.check).toHaveBeenCalledOnce();
    await controller.restart();
    expect(driver.restart).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it("never restarts after download or signature verification fails", async () => {
    const { update, driver, controller } = setup();
    vi.mocked(update.downloadAndInstall).mockRejectedValue(
      new Error("Signature rejected"),
    );
    await controller.check();
    await controller.install();
    await controller.restart();
    expect(controller.snapshot().phase).toBe("error");
    expect(driver.restart).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledOnce();
    await controller.check();
    expect(driver.check).toHaveBeenCalledTimes(2);
  });
  it("handles offline checks and no newer version", async () => {
    const { driver, controller } = setup();
    driver.check.mockRejectedValueOnce(new Error("Offline"));
    await controller.check();
    expect(controller.snapshot().phase).toBe("error");
    driver.check.mockResolvedValueOnce(null);
    await controller.check();
    expect(controller.snapshot()).toEqual({
      phase: "idle",
      message: "You’re up to date.",
    });
  });
  it.each([
    ["No such file or directory (os error 2)", "reopen it from Applications"],
    ["Permission denied (os error 13)", "permission to replace"],
    ["operation timed out", "download timed out"],
    ["Signature rejected", "Signature rejected"],
  ])("explains native install failure: %s", async (error, expected) => {
    const { update, controller } = setup();
    vi.mocked(update.downloadAndInstall).mockRejectedValue(error);
    await controller.check();
    await controller.install();
    expect(controller.snapshot().message).toContain(expected);
    expect(controller.snapshot().phase).toBe("error");
  });
  it("ignores duplicate check requests while a check is in flight", async () => {
    const { driver, controller } = setup();
    let resolve!: (update: null) => void;
    driver.check.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = controller.check();
    await controller.check();
    expect(driver.check).toHaveBeenCalledOnce();
    resolve(null);
    await first;
  });
});
