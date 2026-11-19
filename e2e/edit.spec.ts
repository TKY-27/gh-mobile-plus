import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";
import fileEdit from "../src/data/commit/fixtures/file-edit.json" with { type: "json" };
import file from "../src/data/repo/fixtures/file.json" with { type: "json" };
import refs from "../src/data/repo/fixtures/refs.json" with { type: "json" };
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import enCode from "../src/i18n/messages/en/code.json" with { type: "json" };
import {
  API_ORIGIN,
  expect,
  githubGraphql,
  signIn,
  test,
  type GitHubApi,
} from "./support/github.ts";
import { tapInSheet } from "./support/accounts.ts";
import { openInApp } from "./support/screens.ts";
import { dumpIndexedDb } from "./support/storage.ts";

const REPO = "/octo-org/hello-mobile";
const PATH = "src/alpha.ts";
const HEAD_OID = file.data.repository.head.oid;
const COMMITTED_OID = fileEdit.COMMITTED_OID;
const UPSTREAM_ID = fileEdit.upstreamRepository.id;
const FORK = fileEdit.forkRepository;
const EDITED = `${file.data.repository.object.text} // edited`;
const CONTENTS = Buffer.from(EDITED).toString("base64");
const BRANCH = "ghm/mona/e2e-edit";
const PULL_NUMBER = fileEdit.openedPullRequest.createPullRequest.pullRequest.number;
const HTTP_ACCEPTED = 202;
const HTTP_NOT_FOUND = 404;
const STALE_HEAD = [{ type: "STALE_DATA", message: "Expected branch to point to abc123" }];

type Variables = Record<string, unknown>;

function mockEditing(github: GitHubApi, options: { canPush: boolean; conflictsFirst?: boolean }) {
  const calls: { operation: string; variables: Variables }[] = [];
  let commits = 0;
  const record = (operation: string, variables: Variables) => {
    calls.push({ operation, variables });
  };
  github.use(
    githubGraphql.operation(() =>
      HttpResponse.json({ errors: [{ message: "Outside this test" }] }),
    ),
    http.get(`${API_ORIGIN}/repos/*`, () =>
      HttpResponse.json({ message: "Not Found" }, { status: HTTP_NOT_FOUND }),
    ),
  );
  github.use(
    githubGraphql.query("Repository", () =>
      HttpResponse.json({
        data: {
          repository: {
            ...repository.data.repository,
            viewerPermission: options.canPush ? "WRITE" : "READ",
          },
        },
      }),
    ),
    githubGraphql.query("RepositoryRefs", () => HttpResponse.json(refs)),
    githubGraphql.query("RepositoryFile", () => HttpResponse.json(file)),
    githubGraphql.query("LatestEditFile", () => HttpResponse.json({ data: fileEdit.latestFile })),
    githubGraphql.query("EditRepository", ({ variables }) => {
      record("EditRepository", variables);
      return HttpResponse.json({ data: { repository: fileEdit.upstreamRepository } });
    }),
    githubGraphql.query("EditForkReady", () => HttpResponse.json({ data: { repository: FORK } })),
    http.post(`${API_ORIGIN}/repos/octo-org/hello-mobile/forks`, () => {
      record("fork", {});
      return HttpResponse.json({ owner: FORK.owner, name: FORK.name }, { status: HTTP_ACCEPTED });
    }),
    githubGraphql.mutation("CreateEditBranch", ({ variables }) => {
      record("CreateEditBranch", variables);
      return HttpResponse.json({ data: fileEdit.createdBranch });
    }),
    githubGraphql.mutation("CommitFileEdit", ({ variables }) => {
      record("CommitFileEdit", variables);
      commits++;
      if (options.conflictsFirst && commits === 1) {
        return HttpResponse.json({ errors: STALE_HEAD });
      }
      return HttpResponse.json({ data: fileEdit.committedFile });
    }),
    githubGraphql.mutation("OpenEditPullRequest", ({ variables }) => {
      record("OpenEditPullRequest", variables);
      return HttpResponse.json({ data: fileEdit.openedPullRequest });
    }),
  );
  return calls;
}

async function editFile(page: Page) {
  await openInApp(page, `${REPO}/blob/main/${PATH}`);
  await page.getByRole("button", { name: enCode["edit.action"] }).click();
  await expect(page).toHaveURL(`${REPO}/edit/main/${PATH}`);
  const editor = page.getByRole("textbox", {
    name: enCode["edit.label"].replace("{name}", "alpha.ts"),
  });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" // edited");
  await expect(editor).toContainText("// edited");
  // WebKit can drop presses under load.
  await expect(async () => {
    await page.getByRole("button", { name: enCode["edit.commit"], exact: true }).click();
    await expect(page.getByRole("dialog", { name: enCode["commit.title"] })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();
  // Wait to avoid dismissing the sheet.
  const message = page.getByRole("textbox", { name: enCode["commit.message"] });
  let previous = "";
  await expect
    .poll(async () => {
      const box = JSON.stringify(await message.boundingBox());
      const settled = box === previous;
      previous = box;
      return settled;
    })
    .toBe(true);
  await tapInSheet(message);
}

// Enter submits without scrolling the sheet.
async function submitCommit(page: Page) {
  await page.getByRole("textbox", { name: enCode["commit.message"] }).press("Enter");
}

function commitInput(branch: unknown, owner = "octo-org") {
  return {
    input: {
      branch: { repositoryNameWithOwner: `${owner}/hello-mobile`, branchName: branch },
      expectedHeadOid: HEAD_OID,
      fileChanges: { additions: [{ path: PATH, contents: CONTENTS }] },
      message: { headline: "Update alpha.ts", body: "" },
    },
  };
}

test("commits directly to the branch and lands on the commit", async ({ page, oauth, github }) => {
  const calls = mockEditing(github, { canPush: true });
  await signIn(page, oauth);
  await editFile(page);

  await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/commit/${COMMITTED_OID}`);
  expect(calls).toEqual([{ operation: "CommitFileEdit", variables: commitInput("main") }]);
});

test("commits to a new branch and opens a pull request", async ({ page, oauth, github }) => {
  const calls = mockEditing(github, { canPush: true });
  await signIn(page, oauth);
  await editFile(page);

  await page.getByRole("textbox", { name: enCode["commit.branchName"] }).fill(BRANCH);
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/pull/${String(PULL_NUMBER)}`);
  expect(calls).toEqual([
    {
      operation: "EditRepository",
      variables: { owner: "octo-org", repo: "hello-mobile", findFork: false },
    },
    {
      operation: "CreateEditBranch",
      variables: {
        input: { repositoryId: UPSTREAM_ID, name: `refs/heads/${BRANCH}`, oid: HEAD_OID },
      },
    },
    { operation: "CommitFileEdit", variables: commitInput(BRANCH) },
    {
      operation: "OpenEditPullRequest",
      variables: {
        input: {
          repositoryId: UPSTREAM_ID,
          baseRefName: "main",
          headRefName: BRANCH,
          title: "Update alpha.ts",
          body: "",
        },
      },
    },
  ]);
});

test("without push access, forks and proposes a pull request", async ({ page, oauth, github }) => {
  const calls = mockEditing(github, { canPush: false });
  await signIn(page, oauth);
  await editFile(page);

  await expect(page.getByText(/You can’t push to octo-org\/hello-mobile/)).toBeVisible();
  await page.getByRole("textbox", { name: enCode["commit.branchName"] }).fill(BRANCH);
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/pull/${String(PULL_NUMBER)}`);
  expect(calls).toEqual([
    {
      operation: "EditRepository",
      variables: { owner: "octo-org", repo: "hello-mobile", findFork: true },
    },
    { operation: "fork", variables: {} },
    {
      operation: "CreateEditBranch",
      variables: { input: { repositoryId: FORK.id, name: `refs/heads/${BRANCH}`, oid: HEAD_OID } },
    },
    { operation: "CommitFileEdit", variables: commitInput(BRANCH, FORK.owner.login) },
    {
      operation: "OpenEditPullRequest",
      variables: {
        input: {
          repositoryId: UPSTREAM_ID,
          baseRefName: "main",
          headRefName: `${FORK.owner.login}:${BRANCH}`,
          headRepositoryId: FORK.id,
          title: "Update alpha.ts",
          body: "",
        },
      },
    },
  ]);
});

test("a moved head offers the latest diff and a new branch", async ({ page, oauth, github }) => {
  const calls = mockEditing(github, { canPush: true, conflictsFirst: true });
  await signIn(page, oauth);
  await editFile(page);

  await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
  await submitCommit(page);
  await expect(page.getByRole("alert").filter({ hasText: enCode["conflict.title"] })).toBeVisible();

  await page.getByRole("button", { name: enCode["conflict.viewLatest"] }).click();
  const diff = page.getByRole("table", { name: enCode["conflict.diffLabel"] });
  await expect(diff.getByText('export const greeting = "Hello!";')).toBeVisible();
  await expect(diff.getByText("// edited")).toBeVisible();

  await page.getByRole("button", { name: enCode["commit.newBranchInstead"] }).click();
  await expect(page).toHaveURL(`${REPO}/pull/${String(PULL_NUMBER)}`);

  const branch = calls.find((call) => call.operation === "CreateEditBranch")?.variables;
  expect(branch).toEqual({
    input: {
      repositoryId: UPSTREAM_ID,
      name: expect.stringMatching(/^refs\/heads\/ghm\/mona\/\d{8}-alpha$/),
      oid: HEAD_OID,
    },
  });
  const commits = calls.filter((call) => call.operation === "CommitFileEdit");
  expect(commits.map((call) => call.variables)).toEqual([
    commitInput("main"),
    commitInput(expect.stringMatching(/^ghm\/mona\/\d{8}-alpha$/)),
  ]);
});

for (const editAgain of [false, true]) {
  const title = editAgain
    ? "a background commit preserves later edits and the active tab"
    : "a background commit clears its unchanged draft without leaving the active tab";
  test(title, async ({ page, oauth, github }) => {
    mockEditing(github, { canPush: true });
    let started = false;
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    github.use(
      githubGraphql.mutation("CommitFileEdit", async () => {
        started = true;
        await pending;
        return HttpResponse.json({ data: fileEdit.committedFile });
      }),
    );
    await signIn(page, oauth);
    await editFile(page);
    await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
    await submitCommit(page);
    await expect.poll(() => started).toBe(true);
    try {
      const sheet = page.getByRole("dialog", { name: enCode["commit.title"] });
      await tapInSheet(sheet.getByRole("button", { name: "Close" }));
      await expect(sheet).toHaveCount(0);
      const editor = page.getByRole("textbox", {
        name: enCode["edit.label"].replace("{name}", "alpha.ts"),
      });
      if (editAgain) {
        const selectAll = await page.evaluate(() =>
          /iPhone|iPad/.test(navigator.userAgent) || /Mac/.test(navigator.platform)
            ? "Meta+a"
            : "Control+a",
        );
        await editor.press(selectAll);
        await editor.press("Backspace");
        await expect(editor).toHaveText("");
        await editor.fill("A newer draft");
        await expect(editor).toHaveText("A newer draft");
        await editor.blur();
      }
      await page.locator('[data-tab="search"]').click();
      await expect(page).toHaveURL("/search");
    } finally {
      finish?.();
    }
    await expect(page.getByText(enCode["commit.done"], { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/search");
    await page.locator('[data-tab="home"]').click();
    await expect(page).toHaveURL(`${REPO}/edit/main/${PATH}`);
    if (editAgain) {
      await expect
        .poll(async () => JSON.stringify(await dumpIndexedDb(page)))
        .toContain("A newer draft");
      await page.reload();
      await expect(
        page.getByRole("textbox", { name: enCode["edit.label"].replace("{name}", "alpha.ts") }),
      ).toHaveText("A newer draft");
    } else {
      await expect(
        page.getByRole("button", { name: enCode["edit.commit"], exact: true }),
      ).toBeDisabled();
      await expect
        .poll(async () => JSON.stringify(await dumpIndexedDb(page)))
        .not.toContain("// edited");
    }
  });
}
