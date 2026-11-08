import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  checkPrinter,
  printerProfile,
  renderReceiptPdf,
} from "./printer-output";

const profile = printerProfile(process.env.PRINTER_PROFILE);
if (process.argv.includes("--check")) {
  await checkPrinter(process.env.PRINTER_NAME || "");
  console.log(`${profile.label}: macOS queue found. No receipt was printed.`);
} else {
  const input = process.argv[2];
  const snapshot = input
    ? JSON.parse(await readFile(input, "utf8"))
    : {
        version: 1,
        title: "Good morning.",
        date: "Printer setup preview",
        tasks: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            title: "Take one small step",
            minutes: 5,
            doneWhen: "Your first step is complete.",
            url: "https://example.invalid/?task=preview",
          },
        ],
        briefingUrl: "https://example.invalid/?briefing=preview",
        closingLine: "Have a great day.",
      };
  const directory = resolve(process.env.PRINT_STATE_DIR || ".print-worker");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "preview.pdf");
  const browser = await chromium.launch({ headless: true });
  try {
    await renderReceiptPdf(browser, snapshot, path, profile);
  } finally {
    await browser.close();
  }
  console.log(
    `${profile.label}: saved ${path}. No cloud jobs claimed and nothing printed.`,
  );
}
