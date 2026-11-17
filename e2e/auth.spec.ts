import type { APIRequestContext, Locator, Page } from "@playwright/test";
import enApp from "../src/i18n/messages/en/app.json" with { type: "json" };
import enCommon from "../src/i18n/messages/en/common.json" with { type: "json" };
import jaApp from "../src/i18n/messages/ja/app.json" with { type: "json" };
import enSettings from "../src/i18n/messages/en/settings.json" with { type: "json" };
import { MOCK_GITHUB_ORIGIN } from "./mock-github/protocol.ts";
import {
  accountSheet,
  accountTab,
  addAccount,
  openAccountScreen,
  tapInSheet,
} from "./support/accounts.ts";
import {
  expect,
  MOCK_USERS,
  signIn,
  test,
  type MockOAuth,
  type MockUserName,
} from "./support/github.ts";

const LONG_PRESS_MS = 800;
const APP_ORIGIN_PATTERN = /^https:\/\/localhost:\d+$/;
const HTTP_FORBIDDEN = 403;

async function longPress(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Long-press target is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(LONG_PRESS_MS);
  await page.mouse.up();
}

async function expectActiveAccount(page: Page, user: MockUserName) {
  const { id, login } = MOCK_USERS[user];
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ghm-active-account")))
    .toBe(String(id));
  await openAccountScreen(page);
  await page.getByRole("button", { name: enApp["accounts.switch"] }).click();
  const sheet = accountSheet(page);
  // The check contributes to accessible naming.
  const current = sheet.getByRole("button", { name: enApp["accounts.current"] });
  await expect(current).toContainText(login);
  await tapInSheet(sheet.getByRole("button", { name: enCommon.close }));
  await expect(sheet).toBeHidden();
}

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).flatMap((database) => (database.name ? [database.name] : [])),
  );
}

async function seedDraft(page: Page, accountId: number) {
  await page.evaluate(async (id) => {
    const open = indexedDB.open(`ghm-drafts-${String(id)}`, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("entries");
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error("open failed"));
      };
    });
    const transaction = database.transaction("entries", "readwrite");
    transaction.objectStore("entries").put("draft body", "comment:octo/repo#1");
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
    });
    database.close();
  }, accountId);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ghm-onboarding", "done");
  });
});

test("signing in through GitHub lands on Home", async ({ page, oauth, context }) => {
  await page.goto("/");
  await page.getByRole("link", { name: enApp["signIn.action"] }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: enApp["tabs.home"], level: 1 })).toBeVisible();

  const report = await oauth.report();
  expect(report).toMatchObject({ exchanges: 1, pkceFailures: 0 });
  expect(report.authorizations[0]).toMatchObject({
    code_challenge_method: "S256",
    prompt: "select_account",
    scope: "repo notifications workflow read:org read:user user:email user:follow",
  });
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name).sort()).toEqual(
    expect.arrayContaining([`__Host-ghm_acct_${String(MOCK_USERS.mona.id)}`]),
  );
  const accountCookie = cookies.find((cookie) => cookie.name.startsWith("__Host-ghm_acct_"));
  expect(accountCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
  expect(cookies.some((cookie) => cookie.name === "__Host-ghm_oauth")).toBe(false);
});

test("a second account is added and listed in the account picker", async ({ page, oauth }) => {
  await signIn(page, oauth, "mona");
  await addAccount(page, oauth, "hubot");

  expect((await oauth.report()).authorizations[1]).toMatchObject({ prompt: "select_account" });
  await openAccountScreen(page);
  await page.getByRole("button", { name: enApp["accounts.switch"] }).click();
  const sheet = accountSheet(page);
  await expect(sheet.getByText(MOCK_USERS.mona.login, { exact: true })).toBeVisible();
  await expect(sheet.getByText(MOCK_USERS.hubot.login, { exact: true })).toBeVisible();
});

test("accounts switch by long-pressing the Account tab", async ({ page, oauth }) => {
  await signIn(page, oauth, "mona");
  await addAccount(page, oauth, "hubot");
  await expectActiveAccount(page, "mona");

  await longPress(page, accountTab(page));
  await tapInSheet(accountSheet(page).getByRole("button", { name: MOCK_USERS.hubot.login }));
  await expect(accountSheet(page)).toBeHidden();
  await expectActiveAccount(page, "hubot");
});

test("accounts switch from the Account screen without gestures", async ({ page, oauth }) => {
  await signIn(page, oauth, "mona");
  await addAccount(page, oauth, "hubot");

  await openAccountScreen(page);
  await page.getByRole("button", { name: enApp["accounts.switch"] }).click();
  await tapInSheet(accountSheet(page).getByRole("button", { name: MOCK_USERS.hubot.login }));
  await expectActiveAccount(page, "hubot");
});

test("signing out one account wipes its data and keeps the other", async ({
  page,
  oauth,
  context,
}) => {
  const { mona, hubot } = MOCK_USERS;
  await signIn(page, oauth, "mona");
  await addAccount(page, oauth, "hubot");
  await seedDraft(page, mona.id);
  await seedDraft(page, hubot.id);

  await page.goto("/settings/accounts");
  const signOutOf = enSettings["accounts.signOutOf"].replace("{login}", mona.login);
  await page.getByRole("button", { name: signOutOf }).click();
  await tapInSheet(
    page.getByRole("dialog").getByRole("button", { name: enApp["accounts.signOut"] }),
  );
  await expectActiveAccount(page, "hubot");

  await expect.poll(() => databaseNames(page)).not.toContain(`ghm-drafts-${String(mona.id)}`);
  const remaining = await databaseNames(page);
  expect(remaining).not.toContain(`ghm-cache-${String(mona.id)}`);
  expect(remaining).toContain(`ghm-drafts-${String(hubot.id)}`);
  const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
  expect(cookieNames).not.toContain(`__Host-ghm_acct_${String(mona.id)}`);
  expect(cookieNames).toContain(`__Host-ghm_acct_${String(hubot.id)}`);
  expect((await oauth.report()).revocations).toBe(1);

  await page.reload();
  await expectActiveAccount(page, "hubot");
});

const SIGN_IN_FAILURES = [
  { code: "access_denied", key: "signIn.error.accessDenied" },
  { code: "exchange_failed", key: "signIn.error.exchangeFailed" },
  { code: "state_mismatch", key: "signIn.error.stateMismatch" },
] as const;

async function failSignIn(page: Page, oauth: MockOAuth, code: string) {
  if (code === "access_denied") await oauth.configure({ consent: "deny" });
  if (code === "exchange_failed") await oauth.configure({ failNextExchange: true });
  if (code === "state_mismatch") {
    // A foreign callback lacks the state cookie.
    await page.route(`${MOCK_GITHUB_ORIGIN}/login/oauth/authorize**`, (route) =>
      route.fulfill({ body: "" }),
    );
    await page.goto("/auth/login?mode=add&public=0");
    await page.goto("/auth/callback?code=forged&state=forged");
    return;
  }
  await page.goto("/");
  await page.locator('a[href^="/auth/login"]').click();
}

for (const [locale, messages] of [
  ["en-US", enApp],
  ["ja-JP", jaApp],
] as const) {
  test.describe(`sign-in failures (${locale})`, () => {
    test.use({ locale });

    for (const failure of SIGN_IN_FAILURES) {
      test(`${failure.code} lands on /signin with its message`, async ({ page, oauth }) => {
        await failSignIn(page, oauth, failure.code);
        await expect(page).toHaveURL(`/signin?error=${failure.code}`);
        await expect(page.getByRole("alert")).toHaveText(messages[failure.key]);
        expect((await oauth.report()).pkceFailures).toBe(0);
      });
    }
  });
}

async function postAuth(request: APIRequestContext, path: string, headers: Record<string, string>) {
  return request.post(path, { headers, data: { accountId: MOCK_USERS.mona.id } });
}

test.describe("/auth/* request guard", () => {
  for (const path of ["/auth/token", "/auth/logout"]) {
    test(`${path} rejects requests without a matching Origin or X-GHM-Request`, async ({
      request,
      baseURL,
    }) => {
      if (baseURL === undefined || !APP_ORIGIN_PATTERN.test(baseURL)) {
        throw new Error("baseURL must be the app origin");
      }
      const rejected = [
        { "X-GHM-Request": "1" },
        { Origin: "https://evil.example", "X-GHM-Request": "1" },
        { Origin: baseURL },
        { Origin: baseURL, "X-GHM-Request": "0" },
      ];
      for (const headers of rejected) {
        const response = await postAuth(request, path, headers);
        expect(response.status(), JSON.stringify(headers)).toBe(HTTP_FORBIDDEN);
        expect(await response.json()).toEqual({ error: "forbidden" });
        expect(response.headers()["cache-control"]).toBe("no-store");
      }
      const trusted = await postAuth(request, path, { Origin: baseURL, "X-GHM-Request": "1" });
      expect(trusted.status()).not.toBe(HTTP_FORBIDDEN);
    });
  }
});
