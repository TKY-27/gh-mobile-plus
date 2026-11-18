import type { Page } from "@playwright/test";
import enIssue from "../src/i18n/messages/en/issue.json" with { type: "json" };
import enReview from "../src/i18n/messages/en/review.json" with { type: "json" };
import { MOCK_CLIENT_SECRET } from "./mock-github/protocol.ts";
import { accountTab, addAccount } from "./support/accounts.ts";
import { expect, MOCK_USERS, signIn, test } from "./support/github.ts";
import { API_SCREENS, REPO, SHELL_PATHS } from "./support/screens.ts";
import { dumpBrowserState, dumpIndexedDb } from "./support/storage.ts";

const MIN_SECRETS = 8;
const ISSUE_DRAFT = "Draft: steps to reproduce the offline crash";
const REVIEW_DRAFT = "Draft: why a new import here?";
const REVIEWED_LINE = 2;
const DRAFTS_DB = `ghm-drafts-${String(MOCK_USERS.hubot.id)}`;

function encodings(secret: string): string[] {
  const bytes = Buffer.from(secret);
  const base64 = bytes.toString("base64");
  return [
    secret,
    encodeURIComponent(secret),
    base64,
    base64.replace(/=+$/, ""),
    bytes.toString("base64url"),
  ];
}

async function expectDraftSaved(page: Page, text: string) {
  await expect
    .poll(async () => JSON.stringify((await dumpIndexedDb(page))[DRAFTS_DB] ?? null))
    .toContain(text);
}

async function writeDrafts(page: Page) {
  await page.goto(`${REPO}/issues/42`);
  await page.getByRole("textbox", { name: enIssue["comment.field"] }).fill(ISSUE_DRAFT);
  await expectDraftSaved(page, ISSUE_DRAFT);

  await page.goto(`${REPO}/pull/43/files`);
  await page.getByRole("link", { name: /src\/greeting\.ts/ }).click();
  const line = enReview["diff.addedLine"].replace("{line}", String(REVIEWED_LINE));
  await page.getByRole("button", { name: line, exact: true }).click();
  await page.getByRole("button", { name: enReview["bar.comment"], exact: true }).click();
  const add = page.getByRole("button", { name: enReview["comment.add"] });
  // Typing mid-slide would scroll the sheet away.
  await expect(add).toBeInViewport();
  await page.getByRole("textbox", { name: enReview["comment.field"] }).fill(REVIEW_DRAFT);
  await add.click();
  await expectDraftSaved(page, REVIEW_DRAFT);
}

// WebKit bypasses mocks after worker activation.
test.use({
  serviceWorkers: async ({ browserName }, use) => {
    await use(browserName === "webkit" ? "block" : "allow");
  },
});

test("no token, code or verifier reaches storage, caches, URLs or logs", async ({
  page,
  oauth,
  browserName,
}) => {
  test.slow();
  const serviceWorkerActive = browserName !== "webkit";
  const consoleMessages: string[] = [];
  const navigatedUrls: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => consoleMessages.push(`${error.name}: ${error.message}`));
  page.on("framenavigated", (frame) => navigatedUrls.push(frame.url()));

  // Use another account to enable review.
  await signIn(page, oauth, "hubot");
  await addAccount(page, oauth, "mona");
  for (const path of SHELL_PATHS) {
    await page.goto(path);
    await expect(accountTab(page)).toBeVisible();
  }
  // Reloads discard in-memory tokens.
  for (const screen of API_SCREENS) {
    await page.goto(screen.path);
    await expect(screen.loaded(page)).toBeVisible();
  }
  await writeDrafts(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(
    serviceWorkerActive,
  );

  const dump = await dumpBrowserState(page);
  const report = await oauth.report();
  expect(report.secrets.length).toBeGreaterThanOrEqual(MIN_SECRETS);
  expect(report.refreshes).toBeGreaterThanOrEqual(API_SCREENS.length);
  expect(dump.localStorage["ghm-accounts"]).toContain("mona");
  expect(Object.keys(dump.caches).length > 0).toBe(serviceWorkerActive);
  expect(dump.cookie).not.toContain("ghm_");

  const places: Record<string, string> = {
    localStorage: JSON.stringify(dump.localStorage),
    sessionStorage: JSON.stringify(dump.sessionStorage),
    indexedDB: JSON.stringify(dump.indexedDB),
    caches: JSON.stringify(dump.caches),
    cookie: dump.cookie,
    requestedUrls: dump.requestedUrls.join("\n"),
    navigatedUrls: navigatedUrls.join("\n"),
    currentUrl: page.url(),
    console: consoleMessages.join("\n"),
  };
  const leaks = [...report.secrets, MOCK_CLIENT_SECRET].flatMap((secret, index) =>
    Object.entries(places)
      .filter(([, text]) => encodings(secret).some((encoded) => text.includes(encoded)))
      .map(([place]) => `secret #${String(index)} in ${place}`),
  );
  expect(leaks).toEqual([]);
});
