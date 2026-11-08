import { describe, expect, it } from "vitest";
import { printerProfile, printArguments } from "../scripts/printer-output";
describe("printer output", () => {
  it("uses the same 80mm receipt for either supported printer", () => {
    expect(printerProfile("rongta-80").widthMm).toBe(80);
    expect(printerProfile("netumscan-8360").widthMm).toBe(80);
    expect(() => printerProfile("toString")).toThrow();
    expect(() => printerProfile("unknown")).toThrow();
  });
  it("passes the queue and path as arguments without shell interpretation", () => {
    expect(printArguments("Rongta_USB", "/tmp/a b.pdf")).toEqual([
      "-d",
      "Rongta_USB",
      "-o",
      "fit-to-page",
      "/tmp/a b.pdf",
    ]);
    expect(() => printArguments("", "x")).toThrow();
    expect(() => printArguments("-a", "x")).toThrow();
    expect(() => printArguments("bad\nqueue", "x")).toThrow();
  });
});

it("recovers from a closed Chromium before rendering and produces a real PDF", async () => {
  const { chromium } = await import("@playwright/test");
  const { renderReceiptFile } = await import("../scripts/printer-output");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/daily-driver-render-`);
  let attempts = 0;
  try {
    await renderReceiptFile(
      { version: 1, title: "Recovery check", date: "Today", tasks: [] },
      `${dir}/receipt.pdf`,
      printerProfile(),
      async () => {
        const browser = await chromium.launch();
        if (++attempts === 1) await browser.close();
        return browser;
      },
    );
    expect(attempts).toBe(2);
    expect(
      (await readFile(`${dir}/receipt.pdf`)).subarray(0, 4).toString(),
    ).toBe("%PDF");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
