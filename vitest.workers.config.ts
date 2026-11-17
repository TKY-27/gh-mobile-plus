import { fileURLToPath } from "node:url";
import { buildPagesASSETSBinding, cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-11-10",
        serviceBindings: {
          ASSETS: await buildPagesASSETSBinding(
            fileURLToPath(new URL("./public", import.meta.url)),
          ),
        },
      },
    })),
  ],
  test: { name: "workers", include: ["functions/**/*.test.ts"] },
});
