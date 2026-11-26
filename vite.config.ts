import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const LIGHT_BACKGROUND = "#FFFFFF";
const DEFERRED_CHUNKS = [
  "src/ui/code/editor.tsx",
  "src/features/settings/sections/AboutSection.tsx",
  "src/features/actions/DispatchSheet.tsx",
];

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

function collectDeferredFiles(manifest: Record<string, ManifestChunk>): Set<string> {
  const roots = new Set<string>();
  for (const [key, chunk] of Object.entries(manifest)) {
    if (key.includes("shiki/langs") || key.includes("@shikijs/langs")) roots.add(key);
    if (key.includes("highlight") && chunk.dynamicImports) {
      for (const imp of chunk.dynamicImports) roots.add(imp);
    }
    if (DEFERRED_CHUNKS.includes(key)) roots.add(key);
  }
  const requiredByApp = new Set<string>();
  const stack = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key);
  while (stack.length > 0) {
    const key = stack.pop();
    if (!key || requiredByApp.has(key) || roots.has(key)) continue;
    requiredByApp.add(key);
    const chunk = manifest[key];
    for (const imp of [...(chunk?.imports ?? []), ...(chunk?.dynamicImports ?? [])]) {
      if (!roots.has(imp)) stack.push(imp);
    }
  }
  const deferred = new Set<string>();
  const deferredStack = [...roots];
  const seen = new Set<string>();
  while (deferredStack.length > 0) {
    const key = deferredStack.pop();
    if (!key || seen.has(key) || requiredByApp.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) continue;
    deferred.add(chunk.file);
    for (const imp of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      deferredStack.push(imp);
    }
  }
  return deferred;
}

async function pruneDeferredPrecache<T extends { url: string }>(entries: T[]) {
  const raw = await readFile(resolve("dist/.vite/manifest.json"), "utf8");
  const manifest = JSON.parse(raw) as Record<string, ManifestChunk>;
  const deferred = collectDeferredFiles(manifest);
  const manifestEntries = entries.filter(
    (entry) => !deferred.has(entry.url) && !entry.url.startsWith("assets/highlight.worker-"),
  );
  return { manifest: manifestEntries, warnings: [] };
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "GH Mobile+",
        short_name: "GH Mobile+",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: LIGHT_BACKGROUND,
        background_color: LIGHT_BACKGROUND,
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        manifestTransforms: [pruneDeferredPrecache],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { manifest: true, target: "es2023" },
});
