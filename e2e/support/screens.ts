import type { Locator, Page } from "@playwright/test";
import enApp from "../../src/i18n/messages/en/app.json" with { type: "json" };
import { expect } from "./github.ts";

export interface ApiScreen {
  path: string;
  loaded: (page: Page) => Locator;
}

export const REPO = "/octo-org/hello-mobile";

export function inScreen(page: Page, path: string): Locator {
  return page.locator(`[data-stack-screen="${path}"]`);
}

function titled(path: string, title: string): ApiScreen {
  return {
    path,
    loaded: (page) => inScreen(page, path).getByRole("heading", { level: 1, name: title }),
  };
}

export const API_SCREENS: readonly ApiScreen[] = [
  { path: "/", loaded: (page) => inScreen(page, "/").getByRole("link", { name: /Mona Lisa/ }) },
  {
    path: "/notifications",
    loaded: (page) => inScreen(page, "/notifications").getByText("Fix offline state"),
  },
  titled(`${REPO}/issues/42`, "Crash when opening notifications offline"),
  titled(`${REPO}/pull/43`, "Cache notifications for offline mode"),
  {
    path: `${REPO}/pull/43/files`,
    loaded: (page) =>
      inScreen(page, `${REPO}/pull/43/files`).getByRole("link", { name: /src\/greeting\.ts/ }),
  },
  {
    path: `${REPO}/blob/main/src/alpha.ts`,
    loaded: (page) =>
      inScreen(page, `${REPO}/blob/main/src/alpha.ts`).getByText("export const hello = true;"),
  },
];

export const TAB_ROOTS: Readonly<Record<string, string>> = {
  "/": "home",
  "/pulls": "work",
  "/notifications": "inbox",
  "/search": "search",
  "/account": "account",
};

export const SHELL_PATHS: readonly string[] = [
  ...Object.keys(TAB_ROOTS),
  "/settings",
  "/mona",
  REPO,
  `${REPO}/issues/42`,
  `${REPO}/pull/43`,
  `${REPO}/pull/43/files`,
  `${REPO}/blob/main/src/alpha.ts`,
  `${REPO}/actions`,
];

// Reloading would discard in-memory tokens.
export async function openInApp(page: Page, path: string) {
  const tab = TAB_ROOTS[path];
  if (tab !== undefined) {
    await page.locator(`[data-tab="${tab}"]`).click();
  } else {
    const link = `https://github.com${path}`;
    // Wait for the shell's shortcut listener.
    await expect(page.locator('[data-tab="account"]')).toBeVisible();
    await page.keyboard.press("/");
    await page.getByRole("searchbox").fill(link);
    await page
      .getByRole("menuitem", { name: enApp["palette.jump"].replace("{target}", link) })
      .click();
  }
  await expect(page).toHaveURL(path);
}
