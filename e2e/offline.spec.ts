import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";
import issue from "../src/data/issues/fixtures/issue.json" with { type: "json" };
import enApp from "../src/i18n/messages/en/app.json" with { type: "json" };
import enIssue from "../src/i18n/messages/en/issue.json" with { type: "json" };
import { accountTab } from "./support/accounts.ts";
import {
  API_ORIGIN,
  expect,
  githubGraphql,
  MOCK_USERS,
  signIn,
  test,
  type GitHubApi,
} from "./support/github.ts";
import { API_SCREENS, inScreen, openInApp, REPO, SHELL_PATHS } from "./support/screens.ts";
import { dumpIndexedDb } from "./support/storage.ts";

// Allow the persistence throttle to elapse.
const PERSIST_THROTTLE_MS = 1000;
const ISSUE_PATH = `${REPO}/issues/42`;
const SCREENSHOT_ALT = "Crash screenshot";
const PRIVATE_IMAGE_BODY = `<p>Screenshot:</p><p><img src="https://private-user-images.githubusercontent.com/1001/crash.png?jwt=e2e" alt="${SCREENSHOT_ALT}"></p>`;

function issueWithBody(bodyHTML: string) {
  const subject = issue.data.repository.issueOrPullRequest;
  return {
    data: {
      repository: { ...issue.data.repository, issueOrPullRequest: { ...subject, bodyHTML } },
    },
  };
}

async function goOffline(page: Page, github: GitHubApi) {
  await waitForServiceWorker(page);
  await waitForPersistence(page);
  await page.context().setOffline(true);
  // Routed mocks would otherwise still answer.
  github.use(http.all(`${API_ORIGIN}/*`, () => HttpResponse.error()));
}

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

async function persistedAt(page: Page): Promise<unknown> {
  const entries = (await dumpIndexedDb(page))[`ghm-cache-${String(MOCK_USERS.mona.id)}`]?.entries;
  const client = entries?.find(([key]) => key === "client")?.[1];
  return typeof client === "object" && client !== null && "timestamp" in client
    ? client.timestamp
    : null;
}

async function waitForPersistence(page: Page) {
  await expect
    .poll(async () => {
      const first = await persistedAt(page);
      await page.waitForTimeout(PERSIST_THROTTLE_MS * 2);
      return first !== null && first === (await persistedAt(page));
    })
    .toBe(true);
}

// Offline reloads need the service worker.
test.use({ serviceWorkers: "allow" });

test("the signed-in shell starts offline from the service worker", async ({
  page,
  context,
  oauth,
}) => {
  await signIn(page, oauth);
  await waitForServiceWorker(page);
  await context.setOffline(true);

  for (const path of SHELL_PATHS) {
    await page.goto(path);
    await expect(accountTab(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("GitHub screens render saved data offline with the banner", async ({
  page,
  oauth,
  github,
}) => {
  await signIn(page, oauth);
  // WebKit bypasses mocks after worker activation.
  for (const screen of API_SCREENS) {
    await openInApp(page, screen.path);
    await expect(screen.loaded(page)).toBeVisible();
  }
  await goOffline(page, github);
  for (const screen of API_SCREENS) {
    await page.goto(screen.path);
    await expect(screen.loaded(page)).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: enApp["banner.offline"] }),
    ).toBeVisible();
  }
});

test("private images show a placeholder offline", async ({ page, oauth, github }) => {
  github.use(
    githubGraphql.query("Conversation", () => HttpResponse.json(issueWithBody(PRIVATE_IMAGE_BODY))),
  );
  await signIn(page, oauth);
  await openInApp(page, ISSUE_PATH);
  const screen = inScreen(page, ISSUE_PATH);
  await expect(screen.getByRole("img", { name: SCREENSHOT_ALT })).toBeVisible();

  await goOffline(page, github);
  await page.goto(ISSUE_PATH);
  await expect(screen.getByRole("img", { name: enIssue.offlineImage })).toBeVisible();
  await expect(screen.getByRole("img", { name: SCREENSHOT_ALT })).toHaveCount(0);
});
