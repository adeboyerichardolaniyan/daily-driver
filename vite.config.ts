import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      disable: Boolean(process.env.TAURI_ENV_PLATFORM),
      manifest: {
        name: "Daily Driver",
        short_name: "Daily Driver",
        description: "A little less friction. One step at a time.",
        theme_color: "#111112",
        background_color: "#111112",
        display: "standalone",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,wasm}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/updates\//],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  optimizeDeps: {
    exclude: ["@powersync/web", "@journeyapps/wa-sqlite"],
    include: ["@powersync/web > comlink"],
  },
  worker: { format: "es" },
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  clearScreen: false,
});
