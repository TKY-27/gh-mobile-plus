import type { Page } from "@playwright/test";
import enErrors from "../src/i18n/messages/en/errors.json" with { type: "json" };
import { accountTab } from "./support/accounts.ts";
import {
  expect,
  MOCK_USERS,
  signIn,
  test,
  type ApiRequest,
  type MockOAuth,
} from "./support/github.ts";
import { API_SCREENS, openInApp, TAB_ROOTS, type ApiScreen } from "./support/screens.ts";

// Match the proactive refresh margin.
const CLIENT_EXPIRY_MARGIN_SECONDS = 60;
const STALE_AFTER_SECONDS = 3;
const SHORT_TOKEN_LIFETIME_SECONDS = CLIENT_EXPIRY_MARGIN_SECONDS + STALE_AFTER_SECONDS;
const MILLISECONDS_PER_SECOND = 1000;
const REFRESH_HOLD_MS = 2000;
// Fresh screens trigger requests.
const DETAIL_SCREEN = API_SCREENS.find((screen) => !(screen.path in TAB_ROOTS));

function detailScreen(): ApiScreen {
  if (!DETAIL_SCREEN) throw new Error("API_SCREENS needs a pushed screen");
  return DETAIL_SCREEN;
}

// Root fetches can race the next navigation.
async function signInAndSettle(page: Page, oauth: MockOAuth) {
  await signIn(page, oauth);
  await page.waitForLoadState("networkidle");
}

async function openDetail(page: Page) {
  const screen = detailScreen();
  await openInApp(page, screen.path);
  await expect(screen.loaded(page)).toBeVisible();
}

function unauthorized(requests: readonly ApiRequest[]): string[] {
  return requests
    .filter((request) => request.outcome === "unauthorized")
    .map((request) => `${request.method} ${request.url}`);
}

async function accountDatabases(page: Page): Promise<string[]> {
  const suffix = `-${String(MOCK_USERS.mona.id)}`;
  const names = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ""),
  );
  return names.filter((name) => name.endsWith(suffix));
}

test("two tabs refreshing at once make one refresh call and both keep working", async ({
  page,
  context,
  oauth,
  github,
}) => {
  await oauth.configure({ accessTokenLifetimeSeconds: SHORT_TOKEN_LIFETIME_SECONDS });
  await signInAndSettle(page, oauth);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(accountTab(otherTab)).toBeVisible();
  await otherTab.waitForLoadState("networkidle");

  await page.waitForTimeout((STALE_AFTER_SECONDS + 1) * MILLISECONDS_PER_SECOND);
  // Force contention on the refresh lock.
  await context.route("**/auth/token", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, REFRESH_HOLD_MS));
    await route.fulfill({ response });
  });
  const before = await oauth.report();
  const requestCount = github.requests.length;
  await Promise.all([openDetail(page), openDetail(otherTab)]);

  expect((await oauth.report()).refreshes - before.refreshes).toBe(1);
  expect(unauthorized(github.requests.slice(requestCount))).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(otherTab.getByRole("alert")).toHaveCount(0);
});

test("a 401 from GitHub triggers one refresh and one retry", async ({ page, oauth, github }) => {
  await signInAndSettle(page, oauth);
  const before = await oauth.report();
  const requestCount = github.requests.length;

  await oauth.expireAccessTokens();
  await openDetail(page);

  expect((await oauth.report()).refreshes - before.refreshes).toBe(1);
  const rejected = unauthorized(github.requests.slice(requestCount));
  expect(rejected.length).toBeGreaterThan(0);
  expect(new Set(rejected).size, "each request is retried at most once").toBe(rejected.length);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a rejected refresh token signs the account out with a one-tap reauth", async ({
  page,
  oauth,
}) => {
  await signInAndSettle(page, oauth);
  await oauth.configure({ rejectRefresh: true });
  await oauth.expireAccessTokens();
  await openInApp(page, detailScreen().path);

  const expired = page.getByRole("alert").filter({ hasText: enErrors["authExpired.title"] });
  await expect(expired).toBeVisible();
  await expect.poll(() => accountDatabases(page)).toEqual([]);

  await oauth.configure({ rejectRefresh: false });
  await expired.getByRole("link", { name: enErrors["authExpired.action"] }).click();
  await expect(page).toHaveURL("/");
  expect((await oauth.report()).authorizations.at(-1)).not.toHaveProperty("prompt");
  await openDetail(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
