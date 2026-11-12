import { expect, it } from "vitest";
import { chromium, webkit } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import config from "../vercel.json";

// Exercise the built app with the exact deployment headers, including SQLite/WASM
// startup and the sandboxed receipt iframe. Run npm run build first.
it("boots and renders receipts under the deployed CSP in Chromium and WebKit", async () => {
  const policy = config.headers.find((rule) => rule.source === "/(.*)");
  if (!policy) throw new Error("Missing deployment security headers");
  const headers = Object.fromEntries(
    policy.headers.map((h) => [h.key, h.value]),
  );
  expect(headers["Content-Security-Policy"]).toBeTruthy();
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  const root = path.resolve("dist");
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, "http://localhost").pathname;
    const file = path.resolve(
      root,
      pathname === "/" ? "index.html" : pathname.slice(1),
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        ...headers,
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        });
        const errors: string[] = [];
        const violations: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.exposeFunction("reportViolation", (value: string) =>
          violations.push(value),
        );
        await page.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (e) => {
            void (
              window as unknown as {
                reportViolation: (v: string) => Promise<void>;
              }
            ).reportViolation(e.violatedDirective + ": " + e.blockedURI);
          });
        });
        await page.goto("http://127.0.0.1:" + address.port);
        await page
          .getByRole("button", { name: "New task", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Briefings", exact: true })
          .click();
        await page
          .frameLocator('iframe[title="Receipt preview"]')
          .locator("h1")
          .waitFor();
        expect(errors).toEqual([]);
        expect(violations).toEqual([]);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}, 60000);
