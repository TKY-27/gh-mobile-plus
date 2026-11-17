import { HttpResponse } from "msw";
import pullFixture from "../src/data/pulls/fixtures/pull-request.json" with { type: "json" };
import viewedFixture from "../src/data/review/fixtures/pull-files-viewed.json" with { type: "json" };
import enReview from "../src/i18n/messages/en/review.json" with { type: "json" };
import type { Locator, Page } from "@playwright/test";
import { tapInSheet } from "./support/accounts.ts";
import { expect, githubGraphql, MOCK_USERS, signIn, test } from "./support/github.ts";
import { dumpIndexedDb } from "./support/storage.ts";
import { openInApp } from "./support/screens.ts";

const FILES_PATH = "/octo-org/hello-mobile/pull/43/files";
const PULL_ID = pullFixture.data.repository.issueOrPullRequest.id;
const { baseRefOid: BASE_OID, headRefOid: HEAD_OID } = viewedFixture.data.repository.pullRequest;
const REVIEW_ID = "PRR_pending";
const PATH = "src/greeting.ts";
const DRAG_STEPS = 12;

interface ReviewServer {
  viewed: unknown[];
  started: unknown[];
  threads: Record<string, unknown>[];
  submitted: unknown[];
}

function reviewHandlers(server: ReviewServer) {
  return [
    githubGraphql.query("PendingReview", () =>
      HttpResponse.json({
        data: { node: { baseRefOid: BASE_OID, headRefOid: HEAD_OID, reviews: { nodes: [] } } },
      }),
    ),
    githubGraphql.mutation("MarkFileViewed", ({ variables }) => {
      server.viewed.push(variables);
      return HttpResponse.json({ data: { markFileAsViewed: { clientMutationId: null } } });
    }),
    githubGraphql.mutation("StartReview", ({ variables }) => {
      server.started.push(variables);
      return HttpResponse.json({
        data: { addPullRequestReview: { pullRequestReview: { id: REVIEW_ID } } },
      });
    }),
    githubGraphql.mutation<Record<string, unknown>, { input: Record<string, unknown> }>(
      "AddReviewThread",
      ({ variables }) => {
        server.threads.push(variables.input);
        const id = `PRRT_${String(server.threads.length)}`;
        return HttpResponse.json({ data: { addPullRequestReviewThread: { thread: { id } } } });
      },
    ),
    githubGraphql.mutation("SubmitReview", ({ variables }) => {
      server.submitted.push(variables);
      return HttpResponse.json({
        data: { submitPullRequestReview: { pullRequestReview: { id: REVIEW_ID } } },
      });
    }),
  ];
}

function lineButton(page: Page, line: number) {
  const name = enReview["diff.addedLine"].replace("{line}", String(line));
  return page.getByRole("button", { name, exact: true });
}

/** Intermediate positions exercise cross-row dragging. */
async function dragEndHandleTo(page: Page, target: Locator) {
  const endHandle = await page.locator('[data-handle="end"]').boundingBox();
  const goal = await target.boundingBox();
  if (!endHandle || !goal) throw new Error("handle or target is not rendered");
  const from = { x: endHandle.x + endHandle.width / 2, y: endHandle.y + endHandle.height / 2 };
  const to = { x: from.x, y: goal.y + goal.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: DRAG_STEPS });
  await page.mouse.up();
}

async function addComment(page: Page, body: string) {
  await page.getByRole("button", { name: enReview["bar.comment"], exact: true }).click();
  const add = page.getByRole("button", { name: enReview["comment.add"] });
  // Typing mid-animation can scroll sheets offscreen.
  await expect(add).toBeInViewport();
  await page.getByRole("textbox", { name: enReview["comment.field"] }).fill(body);
  await tapInSheet(add);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("reviews with line, range and suggestion comments that survive a restart", async ({
  page,
  oauth,
  github,
}) => {
  const server: ReviewServer = { viewed: [], started: [], threads: [], submitted: [] };
  github.use(...reviewHandlers(server));
  const keyWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key")) {
      keyWarnings.push(message.text());
    }
  });
  await signIn(page, oauth, "hubot");
  await openInApp(page, FILES_PATH);

  const viewed = enReview["files.viewed"].replace("{path}", PATH);
  const checkbox = page.getByRole("checkbox", { name: viewed });
  // Keyboard toggling avoids RAC's visually hidden input.
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect
    .poll(() => server.viewed)
    .toEqual([{ input: { pullRequestId: PULL_ID, path: PATH } }]);

  await page.getByRole("link", { name: /src\/greeting\.ts/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "greeting.ts" })).toBeVisible();

  await lineButton(page, 2).click();
  await addComment(page, "Why a new import?");
  const firstDraft = enReview["pending.label"].replace(
    "{location}",
    enReview["location.line"].replace("{line}", "2"),
  );
  await expect(page.getByRole("region", { name: firstDraft })).toBeFocused();

  await lineButton(page, 9).click();
  await dragEndHandleTo(page, lineButton(page, 11));
  const threeLines = enReview["bar.lines"].replace(
    "{lines}",
    enReview["bar.lineCount.other"].replace("{count}", "3"),
  );
  await expect(page.getByRole("toolbar").getByText(threeLines, { exact: true })).toBeVisible();
  await addComment(page, "Document the locale fallback.");

  await lineButton(page, 30).click();
  await page.getByRole("button", { name: enReview["bar.suggest"] }).click();
  await expect(page.getByRole("button", { name: enReview["comment.add"] })).toBeInViewport();
  const editor = page.getByRole("textbox", { name: enReview["comment.suggestionLabel"] });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type('export const DEFAULT_LOCALE = "en";');
  await tapInSheet(page.getByRole("button", { name: enReview["comment.add"] }));
  await expect(page.getByText(enReview["pending.badge"], { exact: true })).toHaveCount(3);

  const reviewButton = enReview["bar.reviewCount.other"].replace("{count}", "3");
  await page.getByRole("button", { name: reviewButton }).click();
  const sheet = page.getByRole("dialog", { name: enReview["submit.title"] });
  await tapInSheet(sheet.getByRole("radio", { name: enReview["submit.requestChanges"] }));
  const summary = "Please keep English as the default.";
  await sheet.getByRole("textbox", { name: enReview["submit.summary"] }).fill(summary);
  await tapInSheet(sheet.getByRole("button", { name: "Close" }));
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(async () =>
      JSON.stringify((await dumpIndexedDb(page))[`ghm-drafts-${String(MOCK_USERS.hubot.id)}`]),
    )
    .toContain(summary);
  await page.reload();
  await expect(page.getByText(enReview["pending.badge"], { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: reviewButton }).click();
  await expect(sheet.getByRole("radio", { name: enReview["submit.requestChanges"] })).toBeChecked();
  await expect(sheet.getByRole("textbox", { name: enReview["submit.summary"] })).toHaveValue(
    summary,
  );
  await tapInSheet(sheet.getByRole("button", { name: enReview["submit.action"] }));
  await expect(page.getByText(enReview["submit.done"])).toBeVisible();

  expect(server.started).toEqual([{ input: { pullRequestId: PULL_ID, commitOID: HEAD_OID } }]);
  const thread = { pullRequestReviewId: REVIEW_ID, path: PATH, side: "RIGHT" };
  expect(server.threads).toEqual([
    { ...thread, body: "Why a new import?", line: 2 },
    {
      ...thread,
      body: "Document the locale fallback.",
      line: 11,
      startLine: 9,
      startSide: "RIGHT",
    },
    {
      ...thread,
      body: '```suggestion\nexport const DEFAULT_LOCALE = "en";\n```',
      line: 30,
    },
  ]);
  for (const input of server.threads) expect(input).not.toHaveProperty("position");
  expect(server.submitted).toEqual([
    {
      input: {
        pullRequestReviewId: REVIEW_ID,
        event: "REQUEST_CHANGES",
        body: summary,
      },
    },
  ]);
  await expect(page.getByText(enReview["pending.badge"], { exact: true })).toHaveCount(0);
  expect(keyWarnings).toEqual([]);
});

test("shows the original draft when the pull head moves before submit", async ({
  page,
  oauth,
  github,
}) => {
  const server: ReviewServer = { viewed: [], started: [], threads: [], submitted: [] };
  github.use(...reviewHandlers(server));
  await signIn(page, oauth, "hubot");
  await openInApp(page, FILES_PATH);
  await page.getByRole("link", { name: /src\/greeting\.ts/ }).click();
  await lineButton(page, 2).click();
  const text = "Comment for the original line";
  await addComment(page, text);
  github.use(
    githubGraphql.query("PendingReview", () =>
      HttpResponse.json({
        data: { node: { baseRefOid: BASE_OID, headRefOid: "new-head", reviews: { nodes: [] } } },
      }),
    ),
  );
  await page
    .getByRole("button", { name: enReview["bar.reviewCount.one"].replace("{count}", "1") })
    .click();
  const sheet = page.getByRole("dialog", { name: enReview["submit.title"] });
  await tapInSheet(sheet.getByRole("button", { name: enReview["submit.action"] }));
  await expect(sheet.getByText(enReview["submit.staleDrafts"])).toBeVisible();
  await expect(sheet.getByText(text, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: enReview["submit.action"] })).toHaveCount(0);
  const deleteLabel = enReview["pending.deleteNamed"].replace("{location}", PATH + ":2");
  await tapInSheet(sheet.getByRole("button", { name: deleteLabel }));
  await expect(sheet.getByText(text, { exact: true })).toHaveCount(0);
  expect(server.started).toEqual([]);
  expect(server.threads).toEqual([]);
  expect(server.submitted).toEqual([]);
});

test("Files loads in parallel and switches to the canonical repository after a rename", async ({
  page,
  oauth,
  github,
}) => {
  let releaseHeader: (() => void) | undefined;
  const headerBlocked = new Promise<void>((resolve) => {
    releaseHeader = resolve;
  });
  github.use(
    githubGraphql.query("Conversation", async () => {
      await headerBlocked;
      return HttpResponse.json(pullFixture);
    }),
  );

  await signIn(page, oauth);
  const aliasPath = FILES_PATH.replace("hello-mobile", "old-mobile");
  try {
    await Promise.all([
      page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/repos/octo-org/old-mobile/pulls/43/files",
      ),
      openInApp(page, aliasPath),
    ]);
    const canonicalFiles = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/repos/octo-org/hello-mobile/pulls/43/files",
    );
    releaseHeader?.();
    await canonicalFiles;
  } finally {
    releaseHeader?.();
  }
  await expect(page.getByRole("link", { name: new RegExp(PATH) })).toBeVisible();
});
