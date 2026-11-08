import { chromium, type Browser } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { resolve } from "node:path";
import { chmod } from "node:fs/promises";
import { receiptSchema, renderReceipt } from "../src/domain/receipt";

const execute = promisify(execFile);
// Cloud identifiers are data, never paths.
export function receiptFilePath(
  directory: string,
  id: string,
  extension: "pdf" | "json",
) {
  z.string().uuid().parse(id);
  return resolve(directory, `${id}.${extension}`);
}
export const printerProfiles = {
  "rongta-80": { label: "Rongta 80 mm (USB or Ethernet)", widthMm: 80 },
  "netumscan-8360": { label: "NetumScan 8360 (USB)", widthMm: 80 },
} as const;
export function printerProfile(value = "rongta-80") {
  if (!(value in printerProfiles) || !Object.hasOwn(printerProfiles, value))
    throw new Error("PRINTER_PROFILE must be rongta-80 or netumscan-8360.");
  return printerProfiles[value as keyof typeof printerProfiles];
}
export function printArguments(printer: string, pdfPath: string) {
  if (!printer.trim() || printer.startsWith("-") || /[\r\n]/.test(printer))
    throw new Error(
      "Set PRINTER_NAME to the exact macOS queue name from lpstat -p.",
    );
  // Media/cutter options belong to the installed driver; do not assume vendor-specific names.
  return ["-d", printer, "-o", "fit-to-page", pdfPath];
}
export async function checkPrinter(printer: string) {
  printArguments(printer, "receipt.pdf");
  await execute("/usr/bin/lpstat", ["-p", printer], { timeout: 10000 });
}
export async function renderReceiptPdf(
  browser: Browser,
  input: unknown,
  path: string,
  profile = printerProfile(),
) {
  const snapshot = receiptSchema.parse(input);
  const page = await browser.newPage({
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  try {
    await page.route("**/*", (route) => route.abort());
    await page.setViewportSize({
      width: Math.ceil((profile.widthMm * 96) / 25.4),
      height: 800,
    });
    await page.emulateMedia({ media: "print" });
    await page.setContent(await renderReceipt(snapshot), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const height = await page.evaluate(() =>
      Math.ceil(document.body.scrollHeight),
    );
    await page.pdf({
      path,
      width: `${profile.widthMm}mm`,
      height: `${height + 32}px`,
      margin: { top: "4mm", bottom: "4mm", left: "4mm", right: "4mm" },
      printBackground: true,
    });
    await chmod(path, 0o600);
  } finally {
    await page.close();
  }
}

// A receipt gets a fresh browser, so an idle process closing cannot poison the worker.
// Only rendering retries; physical dispatch is outside this function.
export async function renderReceiptFile(
  input: unknown,
  path: string,
  profile = printerProfile(),
  launch: () => Promise<Browser> = () => chromium.launch({ headless: true }),
) {
  receiptSchema.parse(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    let browser: Browser | undefined;
    try {
      browser = await launch();
      await renderReceiptPdf(browser, input, path, profile);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}
