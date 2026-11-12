import { expect, it } from "vitest";
import { chromium, webkit } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const legacyHtml = `<!doctype html><html><body><div class="briefing-page-footer">Content collections 1</div><script>navigator.serviceWorker.register('/sw.js')</script></body></html>`;
// Reproduce the old prompt-only worker: cached navigation, no skipWaiting UI.
const legacyWorker = `
self.addEventListener('install', event => event.waitUntil(caches.open('legacy-app').then(cache => cache.add('/'))));
self.addEventListener('fetch', event => { if (event.request.mode === 'navigate') event.respondWith(caches.open('legacy-app').then(cache => cache.match('/'))); });
`;

it("upgrades an existing cached tab and lets users save edits before refreshing", async () => {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
  };
  for (const engine of [chromium, webkit]) {
    let legacy = true;
    let revision = 1;
    const root = path.resolve("dist");
    const server = createServer(async (req, res) => {
      const pathname = new URL(req.url!, "http://localhost").pathname;
      if (legacy && ["/", "/sw.js"].includes(pathname)) {
        res.writeHead(200, {
          "Content-Type": pathname === "/" ? "text/html" : "text/javascript",
          "Cache-Control": "no-store",
        });
        res.end(pathname === "/" ? legacyHtml : legacyWorker);
        return;
      }
      const file = path.resolve(
        root,
        pathname === "/" ? "index.html" : pathname.slice(1),
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      try {
        let body = await readFile(file);
        if (pathname === "/sw.js")
          body = Buffer.concat([
            body,
            Buffer.from(`\n// release ${revision}\n`),
          ]);
        res
          .writeHead(200, {
            "Content-Type":
              types[path.extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
          })
          .end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const browser = await engine.launch();
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test address");
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/?view=briefings`);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      expect(await page.locator(".briefing-page-footer").count()).toBe(1);
      legacy = false;
      await page.evaluate(async () => {
        const controlling = new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          );
        });
        const registration = await navigator.serviceWorker.getRegistration();
        await registration!.update();
        await controlling;
      });
      await page.reload();
      await page.locator(".briefing-editor-header").waitFor();
      expect(await page.locator(".briefing-page-footer").count()).toBe(0);
      await page
        .getByLabel("Heading", { exact: true })
        .fill("Keep my unsaved work");
      revision = 2;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update();
      });
      await page
        .getByRole("button", { name: "Refresh app", exact: true })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page
          .getByRole("button", { name: "Refresh app", exact: true })
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.getByLabel("Heading", { exact: true }).inputValue(),
      ).toBe("Keep my unsaved work");
      await page
        .getByRole("button", { name: "Save template", exact: true })
        .click();
      await page.getByText("Template saved.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Refresh app", exact: true })
        .click();
      await page.getByLabel("Heading", { exact: true }).waitFor();
      expect(
        await page.getByLabel("Heading", { exact: true }).inputValue(),
      ).toBe("Keep my unsaved work");
      await context.setOffline(true);
      await page.reload();
      await page.getByLabel("Heading", { exact: true }).waitFor();
      expect(
        await page.getByLabel("Heading", { exact: true }).inputValue(),
      ).toBe("Keep my unsaved work");
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}, 60000);
