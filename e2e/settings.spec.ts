import organizations from "../src/data/users/fixtures/organizations.json" with { type: "json" };
import profile from "../src/data/users/fixtures/profile.json" with { type: "json" };
import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";
import enApp from "../src/i18n/messages/en/app.json" with { type: "json" };
import enSettings from "../src/i18n/messages/en/settings.json" with { type: "json" };
import jaApp from "../src/i18n/messages/ja/app.json" with { type: "json" };
import { openAccountScreen } from "./support/accounts.ts";
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";

const HTTP_NOT_FOUND = 404;
const MAX_ACCOUNTS = 5;

test.beforeEach(({ github }) => {
  github.use(
    githubGraphql.query("ViewerOrganizations", () => HttpResponse.json(organizations)),
    githubGraphql.query("Profile", () => HttpResponse.json(profile)),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/readme`, () =>
      HttpResponse.json({ message: "Not Found" }, { status: HTTP_NOT_FOUND }),
    ),
  );
});

async function openSection(page: Page, label: string) {
  await openAccountScreen(page);
  await page.getByRole("link", { name: enApp["settings.root"] }).click();
  await page.getByRole("link", { name: label }).click();
  await expect(page.getByRole("heading", { name: label, level: 1 })).toBeAttached();
}

function storedPreferences(page: Page): Promise<unknown> {
  return page.evaluate((): unknown => JSON.parse(localStorage.getItem("ghm-preferences") ?? "{}"));
}

test("switching the language to Japanese changes the UI text immediately", async ({
  page,
  oauth,
}) => {
  await signIn(page, oauth);
  await openSection(page, enApp["settings.appearance"]);
  await page.getByRole("radio", { name: enSettings["language.ja"] }).click();

  await expect(
    page.getByRole("heading", { name: jaApp["settings.appearance"], level: 1 }),
  ).toBeAttached();
  await expect(page.locator('[data-tab="account"]')).toContainText(jaApp["tabs.account"]);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  expect(await storedPreferences(page)).toMatchObject({ language: "ja" });
});

test("the theme switch applies and survives a reload", async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openSection(page, enApp["settings.appearance"]);
  await page.getByRole("radio", { name: enSettings["theme.dark"] }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("radiogroup", { name: enSettings["theme.title"] })
    .getByRole("radio", { name: enSettings.followSystem })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("turning off offline private content persists", async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openSection(page, enApp["settings.offline"]);
  const toggle = page.getByRole("switch", { name: enSettings["offline.toggle"] });
  await expect(toggle).toBeChecked();
  await page.getByText(enSettings["offline.toggle"], { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText(enSettings["offline.footerOff"])).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: enSettings["offline.toggle"] })).not.toBeChecked();
  expect(await storedPreferences(page)).toMatchObject({ keepPrivateOffline: false });
});

test("adding an account is disabled at the five-account limit", async ({ page, oauth }) => {
  await signIn(page, oauth);
  // Mock OAuth has only two users.
  await page.route("**/auth/accounts", async (route) => {
    const response = await route.fetch();
    const listed: unknown = await response.json();
    const signedIn: readonly unknown[] = Array.isArray(listed) ? listed : [];
    const extra = Array.from({ length: MAX_ACCOUNTS - signedIn.length }, (_, index) => ({
      id: 9000 + index,
      login: `listed-${String(index)}`,
      avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
      publicOnly: false,
    }));
    await route.fulfill({ response, json: [...signedIn, ...extra] });
  });
  await page.reload();
  await openSection(page, enApp["settings.accounts"]);

  await expect(page.getByText("listed-0", { exact: true })).toBeVisible();
  await expect(page.getByText(enSettings["accounts.limitReached"])).toBeVisible();
  await expect(
    page.getByText(enApp["accounts.limit"].replace("{max}", String(MAX_ACCOUNTS))),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: enApp["accounts.add"] })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: enApp["signIn.publicOnly"] })).toBeDisabled();
});
