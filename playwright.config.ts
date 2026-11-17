import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import {
  HEALTH_PATH,
  MOCK_CLIENT_ID,
  MOCK_CLIENT_SECRET,
  MOCK_GITHUB_ORIGIN,
} from "./e2e/mock-github/protocol.ts";

const APP_PORT = 8788;
// WebKit applies the CSP upgrade-insecure-requests to localhost.
const APP_ORIGIN = `https://localhost:${String(APP_PORT)}`;
const SERVER_START_TIMEOUT_MS = 120_000;
const COOKIE_KEY_ID = "e2e";
const COOKIE_KEY_BYTES = 32;

// Every key is set so a local .dev.vars never applies.
const workerBindings = {
  GHM_GITHUB_CLIENT_ID: MOCK_CLIENT_ID,
  GHM_GITHUB_CLIENT_SECRET: MOCK_CLIENT_SECRET,
  GHM_COOKIE_KEYS: JSON.stringify({
    [COOKIE_KEY_ID]: randomBytes(COOKIE_KEY_BYTES).toString("base64"),
  }),
  GHM_COOKIE_ACTIVE_KID: COOKIE_KEY_ID,
  GHM_TOKEN_MODE: "expiring",
  GHM_DEV_INSECURE_COOKIES: "0",
  GHM_GITHUB_OAUTH_ORIGIN: MOCK_GITHUB_ORIGIN,
  GHM_GITHUB_API_ORIGIN: MOCK_GITHUB_ORIGIN,
};
const bindingFlags = Object.entries(workerBindings)
  .map(([name, value]) => `--binding '${name}=${value}'`)
  .join(" ");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP_ORIGIN,
    ignoreHTTPSErrors: true,
    locale: "en-US",
    // WebKit cannot route fetches from controlled pages; specs opt in.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"], browserName: "webkit" } },
    {
      name: "pixel",
      use: {
        ...devices["Pixel 8"],
        browserName: "chromium",
        // Service worker scripts ignore ignoreHTTPSErrors.
        launchOptions: { args: ["--ignore-certificate-errors"] },
      },
    },
    {
      // SPEC 4.8 covers desktop tabs too.
      name: "desktop",
      testMatch: "auth.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--ignore-certificate-errors"] },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-github/server.ts",
      url: `${MOCK_GITHUB_ORIGIN}${HEALTH_PATH}`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm build && pnpm exec wrangler pages dev dist --port ${String(APP_PORT)} --local-protocol https ${bindingFlags}`,
      url: APP_ORIGIN,
      ignoreHTTPSErrors: true,
      timeout: SERVER_START_TIMEOUT_MS,
      reuseExistingServer: false,
    },
  ],
});
