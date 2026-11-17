import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "unit",
    environment: "jsdom",
    css: { include: [/\/src\/ui\/tokens\.css/] },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
