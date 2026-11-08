import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/security-policy.browser.ts"], environment: "node" },
});
