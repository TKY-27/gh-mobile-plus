import type { Locator, Page } from "@playwright/test";
import { delay, http, HttpResponse } from "msw";
import enCommon from "../src/i18n/messages/en/common.json" with { type: "json" };
import enInbox from "../src/i18n/messages/en/inbox.json" with { type: "json" };
import { API_ORIGIN, expect, signIn, test, type GitHubApi } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

// Wait beyond the undo window.
const UNDO_WINDOW_MS = 5000;
const SETTLE_MS = UNDO_WINDOW_MS + 1500;
const DRAG_STEPS = 12;
const DRAG_STEP_MS = 16;
const HTTP_SERVER_ERROR = 500;
const HTTP_RESET_CONTENT = 205;
const THREAD_TITLE = "Fix offline state";
const SECOND_TITLE = "Improve review";
const SECOND_SWIPE_DELAY_MS = 1400;
const FIXTURE_THREADS = 5;
const WRITE_LATENCY_MS = 400;

function row(page: Page, title: string): Locator {
  return page.locator('[data-stack-screen="/notifications"] li').filter({ hasText: title });
}

async function swipe(page: Page, target: Locator, direction: 1 | -1) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Row is not visible");
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  const distance = box.width * 0.45 * direction;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= DRAG_STEPS; step++) {
    await page.mouse.move(startX + (distance * step) / DRAG_STEPS, y);
    await page.waitForTimeout(DRAG_STEP_MS);
  }
  await page.mouse.up();
}

function countWrites(github: GitHubApi, status = HTTP_RESET_CONTENT, latencyMs = 0) {
  const writes: string[] = [];
  const respond = async ({ request }: { request: Request }) => {
    writes.push(`${request.method} ${new URL(request.url).pathname}`);
    await delay(latencyMs);
    return status === HTTP_RESET_CONTENT
      ? new HttpResponse(null, { status })
      : HttpResponse.json({ message: "Server error" }, { status });
  };
  github.use(
    http.delete(`${API_ORIGIN}/notifications/threads/:id`, respond),
    http.patch(`${API_ORIGIN}/notifications/threads/:id`, respond),
  );
  return writes;
}

test.beforeEach(async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openInApp(page, "/notifications");
  await expect(row(page, THREAD_TITLE)).toBeVisible();
});

test("swipe right marks a thread done after the undo window", async ({ page, github }) => {
  const writes = countWrites(github);
  await swipe(page, row(page, THREAD_TITLE), 1);
  await expect(row(page, THREAD_TITLE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: enCommon.undo })).toBeVisible();
  expect(writes).toEqual([]);
  await expect
    .poll(() => writes, { timeout: SETTLE_MS })
    .toEqual(["DELETE /notifications/threads/1"]);
});

test("a newer swipe replaces the Undo, and none outlives its request", async ({ page, github }) => {
  const writes = countWrites(github);
  await swipe(page, row(page, THREAD_TITLE), 1);
  await page.waitForTimeout(SECOND_SWIPE_DELAY_MS);
  await swipe(page, row(page, SECOND_TITLE), 1);
  const undo = page.getByRole("button", { name: enCommon.undo });
  await expect(undo).toHaveCount(1);
  await expect
    .poll(() => writes, { timeout: SETTLE_MS })
    .toEqual(["DELETE /notifications/threads/1"]);
  await undo.click();
  await expect(row(page, SECOND_TITLE)).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  expect(writes).toEqual(["DELETE /notifications/threads/1"]);
});

test("Undo disappears when its request is sent", async ({ page, github }) => {
  const writes = countWrites(github);
  await swipe(page, row(page, THREAD_TITLE), 1);
  const undo = page.getByRole("button", { name: enCommon.undo });
  await expect(undo).toBeVisible();
  await undo.hover();
  await expect.poll(() => writes, { timeout: SETTLE_MS }).toHaveLength(1);
  await expect(undo).toHaveCount(0);
});

test("opening a thread marks it read at once", async ({ page, github }) => {
  const writes = countWrites(github);
  await row(page, THREAD_TITLE)
    .getByRole("button", { name: new RegExp(THREAD_TITLE) })
    .first()
    .click();
  await expect.poll(() => writes).toEqual(["PATCH /notifications/threads/1"]);
});

test("a failed Done rolls the thread back and offers Retry", async ({ page, github }) => {
  const writes = countWrites(github, HTTP_SERVER_ERROR);
  await swipe(page, row(page, THREAD_TITLE), 1);
  await expect(row(page, THREAD_TITLE)).toHaveCount(0);
  await expect(row(page, THREAD_TITLE)).toBeVisible({ timeout: SETTLE_MS });
  expect(writes).toEqual(["DELETE /notifications/threads/1"]);
  await expect(page.getByRole("button", { name: enCommon.retry })).toBeVisible();
});

test("Undo inside the window restores the thread and sends nothing", async ({ page, github }) => {
  const writes = countWrites(github);
  await swipe(page, row(page, THREAD_TITLE), -1);
  await expect(row(page, THREAD_TITLE)).toHaveCount(0);
  await page.getByRole("button", { name: enCommon.undo }).click();
  await expect(row(page, THREAD_TITLE)).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  expect(writes).toEqual([]);
});

test("every row action is reachable without gestures", async ({ page }) => {
  await row(page, THREAD_TITLE)
    .getByRole("button", { name: enInbox.actionsFor.replace("{title}", THREAD_TITLE) })
    .click();
  const sheet = page.getByRole("dialog", { name: THREAD_TITLE });
  for (const label of [
    enInbox["action.markDone"],
    enInbox["action.markRead"],
    enInbox["action.unsubscribe"],
    enCommon.openOnGitHub,
  ]) {
    await expect(sheet.getByRole("button", { name: label })).toBeVisible();
  }
});

test("bulk Done shows progress and clears the selection", async ({ page, github }) => {
  const writes = countWrites(github, HTTP_RESET_CONTENT, WRITE_LATENCY_MS);
  await page.getByRole("button", { name: enInbox.select, exact: true }).click();
  await page.getByRole("button", { name: enInbox.selectAll }).click();
  const toolbar = page.getByRole("group", { name: enInbox["bulk.label"] });
  await expect(toolbar).toContainText(`${String(FIXTURE_THREADS)} selected`);
  await toolbar.getByRole("button", { name: enInbox["action.done"] }).click();
  await expect(toolbar.getByRole("progressbar")).toBeVisible();
  await expect(
    page.getByText(`Marked ${String(FIXTURE_THREADS)} notifications as done`),
  ).toBeVisible();
  expect(writes).toHaveLength(FIXTURE_THREADS);
  await expect(toolbar).toBeHidden();
});
