import type { Page } from "@playwright/test";
import { http, HttpResponse } from "msw";
import fileEdit from "../src/data/commit/fixtures/file-edit.json" with { type: "json" };
import file from "../src/data/repo/fixtures/file.json" with { type: "json" };
import refs from "../src/data/repo/fixtures/refs.json" with { type: "json" };
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import tree from "../src/data/repo/fixtures/tree.json" with { type: "json" };
import enCode from "../src/i18n/messages/en/code.json" with { type: "json" };
import { tapInSheet } from "./support/accounts.ts";
import {
  API_ORIGIN,
  expect,
  githubGraphql,
  signIn,
  test,
  type GitHubApi,
} from "./support/github.ts";
import { openInApp } from "./support/screens.ts";
import { dumpIndexedDb } from "./support/storage.ts";

const REPO = "/octo-org/hello-mobile";
const HEAD_OID = file.data.repository.head.oid;
const COMMITTED_OID = fileEdit.COMMITTED_OID;
const UPSTREAM_ID = fileEdit.upstreamRepository.id;
const FORK = fileEdit.forkRepository;
const BRANCH = "ghm/mona/e2e-create";
const PULL_NUMBER = fileEdit.openedPullRequest.createPullRequest.pullRequest.number;
const HTTP_ACCEPTED = 202;
const HTTP_NOT_FOUND = 404;

type Variables = Record<string, unknown>;

interface MockOptions {
  canPush?: boolean;
  forkingAllowed?: boolean;
  isArchived?: boolean;
  existingPaths?: readonly string[];
  branchExists?: boolean;
}

function mockCreation(github: GitHubApi, options: MockOptions = {}) {
  const canPush = options.canPush ?? true;
  const forkingAllowed = options.forkingAllowed ?? true;
  const isArchived = options.isArchived ?? false;
  const branchExists = options.branchExists ?? true;
  const existing = new Set(options.existingPaths ?? []);
  const calls: { operation: string; variables: Variables }[] = [];
  const record = (operation: string, variables: Variables) => {
    calls.push({ operation, variables });
  };
  const repoState = (path?: string) => ({
    hasPullRequestsEnabled: true,
    isPrivate: false,
    isArchived,
    isDisabled: false,
    isLocked: false,
    isEmpty: false,
    forkingAllowed,
    viewerPermission: canPush ? "WRITE" : "READ",
    ref: branchExists
      ? {
          prefix: "refs/heads/",
          target: {
            __typename: "Commit",
            oid: HEAD_OID,
            file: path && existing.has(path) ? { type: "blob" } : null,
            parent: { type: "tree" },
          },
        }
      : null,
    directory: { __typename: "Tree" },
  });

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
            viewerPermission: canPush ? "WRITE" : "READ",
            isArchived,
          },
        },
      }),
    ),
    githubGraphql.query("RepositoryRefs", () => HttpResponse.json(refs)),
    githubGraphql.query("RepositoryTree", () => HttpResponse.json(tree)),
    githubGraphql.query("CreateFileContext", () =>
      HttpResponse.json({ data: { repository: repoState() } }),
    ),
    githubGraphql.query("CheckNewFilePath", ({ variables }) => {
      record("CheckNewFilePath", variables);
      const path = typeof variables.path === "string" ? variables.path : "";
      return HttpResponse.json({ data: { repository: repoState(path) } });
    }),
    githubGraphql.query("CheckCommitEntry", ({ variables }) => {
      record("CheckCommitEntry", variables);
      return HttpResponse.json({
        data: { repository: { object: { __typename: "Commit", file: { type: "tree" } } } },
      });
    }),
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
      return HttpResponse.json({ data: fileEdit.committedFile });
    }),
    githubGraphql.mutation("OpenEditPullRequest", ({ variables }) => {
      record("OpenEditPullRequest", variables);
      return HttpResponse.json({ data: fileEdit.openedPullRequest });
    }),
  );
  return calls;
}

async function openCommitSheet(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: enCode["edit.commit"], exact: true }).click();
    await expect(page.getByRole("dialog", { name: enCode["create.commitTitle"] })).toBeVisible({
      timeout: 2000,
    });
  }).toPass();
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

test("creates a file directly from the repository tree with optimistic head verification", async ({
  page,
  oauth,
  github,
}) => {
  const calls = mockCreation(github);
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/tree/refs%2Fheads%2Fmain/src`);

  await page.getByRole("button", { name: enCode["create.action"] }).click();
  await expect(page).toHaveURL(`${REPO}/new/main/src`);

  const pathInput = page.getByRole("textbox", { name: enCode["create.pathLabel"] });
  await expect(pathInput).not.toHaveAttribute("aria-invalid", "true");
  await pathInput.fill("notes.md");

  const editor = page.getByRole("textbox", { name: enCode["create.editorLabel"] });
  await editor.click();
  await page.keyboard.type("# Hello");
  await expect(editor).toContainText("# Hello");

  await openCommitSheet(page);
  await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/commit/${COMMITTED_OID}`);
  expect(calls).toEqual([
    {
      operation: "CheckNewFilePath",
      variables: {
        owner: "octo-org",
        repo: "hello-mobile",
        ref: "refs/heads/main",
        path: "src/notes.md",
        parentPath: "src",
        hasParent: true,
      },
    },
    {
      operation: "CommitFileEdit",
      variables: {
        input: {
          branch: { repositoryNameWithOwner: "octo-org/hello-mobile", branchName: "main" },
          expectedHeadOid: HEAD_OID,
          fileChanges: {
            additions: [
              { path: "src/notes.md", contents: Buffer.from("# Hello").toString("base64") },
            ],
          },
          message: { headline: "Create notes.md", body: "" },
        },
      },
    },
  ]);
});

test("creates a file on a new branch and opens a pull request", async ({ page, oauth, github }) => {
  const calls = mockCreation(github);
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/new/main/src`);

  await page.getByRole("textbox", { name: enCode["create.pathLabel"] }).fill("utils/notes.ts");
  const editor = page.getByRole("textbox", { name: enCode["create.editorLabel"] });
  await editor.click();
  await page.keyboard.type("export const ready = true;");

  await openCommitSheet(page);
  await page.getByRole("textbox", { name: enCode["commit.branchName"] }).fill(BRANCH);
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/pull/${String(PULL_NUMBER)}`);
  expect(calls).toEqual([
    {
      operation: "CheckNewFilePath",
      variables: {
        owner: "octo-org",
        repo: "hello-mobile",
        ref: "refs/heads/main",
        path: "src/utils/notes.ts",
        parentPath: "src/utils",
        hasParent: true,
      },
    },
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
    {
      operation: "CommitFileEdit",
      variables: {
        input: {
          branch: { repositoryNameWithOwner: "octo-org/hello-mobile", branchName: BRANCH },
          expectedHeadOid: HEAD_OID,
          fileChanges: {
            additions: [
              {
                path: "src/utils/notes.ts",
                contents: Buffer.from("export const ready = true;").toString("base64"),
              },
            ],
          },
          message: { headline: "Create notes.ts", body: "" },
        },
      },
    },
    {
      operation: "OpenEditPullRequest",
      variables: {
        input: {
          repositoryId: UPSTREAM_ID,
          baseRefName: "main",
          headRefName: BRANCH,
          title: "Create notes.ts",
          body: "",
        },
      },
    },
  ]);
});

test("without push access, forks and proposes a new file as a pull request", async ({
  page,
  oauth,
  github,
}) => {
  const calls = mockCreation(github, { canPush: false, forkingAllowed: true });
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/new/main`);

  await page.getByRole("textbox", { name: enCode["create.pathLabel"] }).fill("notes.md");
  const editor = page.getByRole("textbox", { name: enCode["create.editorLabel"] });
  await editor.click();
  await page.keyboard.type("forked note");

  await openCommitSheet(page);
  await expect(page.getByText(/You can’t push to octo-org\/hello-mobile/)).toBeVisible();
  await page.getByRole("textbox", { name: enCode["commit.branchName"] }).fill(BRANCH);
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/pull/${String(PULL_NUMBER)}`);
  expect(calls.map((call) => call.operation)).toEqual([
    "CheckNewFilePath",
    "EditRepository",
    "fork",
    "CreateEditBranch",
    "CommitFileEdit",
    "OpenEditPullRequest",
  ]);
});

test("prevents overwriting an existing file, retains the draft across reload, and commits after renaming", async ({
  page,
  oauth,
  github,
}) => {
  const calls = mockCreation(github, { existingPaths: ["src/alpha.ts"] });
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/new/main/src`);

  const pathInput = page.getByRole("textbox", { name: enCode["create.pathLabel"] });
  await pathInput.fill("alpha.ts");
  const editor = page.getByRole("textbox", { name: enCode["create.editorLabel"] });
  await editor.click();
  await page.keyboard.type("keep this draft");

  await openCommitSheet(page);
  await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
  await submitCommit(page);

  const alert = page.getByRole("alert").filter({ hasText: enCode["create.conflict.existsTitle"] });
  await expect(alert).toBeVisible();
  expect(calls.filter((call) => call.operation === "CommitFileEdit")).toEqual([]);

  await page.getByRole("button", { name: enCode["create.changePath"] }).click();
  await expect(page.getByRole("dialog", { name: enCode["create.commitTitle"] })).toBeHidden();
  await expect(pathInput).toBeFocused();
  await expect(pathInput).toHaveValue("alpha.ts");
  await expect(editor).toContainText("keep this draft");

  // Reload to verify IndexedDB draft persistence.
  await expect
    .poll(async () => JSON.stringify(await dumpIndexedDb(page)))
    .toContain("keep this draft");
  await page.reload();
  await expect(page.getByText(enCode["create.restored"])).toBeVisible();
  await expect(pathInput).toHaveValue("alpha.ts");
  await expect(page.getByRole("textbox", { name: enCode["create.editorLabel"] })).toContainText(
    "keep this draft",
  );

  await pathInput.fill("beta.ts");
  await openCommitSheet(page);
  await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
  await submitCommit(page);

  await expect(page).toHaveURL(`${REPO}/commit/${COMMITTED_OID}`);
  expect(calls.filter((call) => call.operation === "CommitFileEdit")).toHaveLength(1);
});

test("validates file paths accessibly and enforces branch and permission eligibility", async ({
  page,
  oauth,
  github,
}) => {
  mockCreation(github);
  await signIn(page, oauth);

  // Tags hide the tree create action.
  await openInApp(page, `${REPO}/tree/refs%2Ftags%2Fv1.0.0`);
  await expect(page.getByRole("link", { name: /alpha\.ts/ })).toBeVisible();
  await expect(page.getByRole("button", { name: enCode["create.action"] })).toHaveCount(0);

  // Validation defers errors until submit.
  await openInApp(page, `${REPO}/new/main`);
  const pathInput = page.getByRole("textbox", { name: enCode["create.pathLabel"] });
  await expect(pathInput).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: enCode["edit.commit"], exact: true }).click();
  await expect(page.getByText(enCode["create.validation.empty"])).toBeVisible();
  await expect(pathInput).toHaveAttribute("aria-invalid", "true");
  await expect(pathInput).toBeFocused();

  await pathInput.fill("../escape.ts");
  await page.getByRole("button", { name: enCode["edit.commit"], exact: true }).click();
  await expect(page.getByText(enCode["create.validation.dotSegment"])).toBeVisible();
  await expect(page.getByRole("dialog", { name: enCode["create.commitTitle"] })).toHaveCount(0);

  await pathInput.fill("safe.ts");
  await expect(page.getByText(enCode["create.validation.dotSegment"])).toHaveCount(0);
  await expect(pathInput).not.toHaveAttribute("aria-invalid", "true");

  // Non-branch refs cannot create files.
  mockCreation(github, { branchExists: false });
  await page.goto(`${REPO}/new/v1.0.0`);
  await expect(page.getByText(enCode["create.ineligible.notBranch.title"])).toBeVisible();
  await expect(
    page.getByRole("button", { name: enCode["edit.commit"], exact: true }),
  ).toBeDisabled();

  // Archived repositories block file creation.
  mockCreation(github, { isArchived: true });
  await page.goto(`${REPO}/new/main/src`);
  await expect(page.getByText(enCode["create.ineligible.archived.title"])).toBeVisible();
  await expect(
    page.getByRole("button", { name: enCode["edit.commit"], exact: true }),
  ).toBeDisabled();
});

for (const changePath of [false, true]) {
  const title = changePath
    ? "a late create result leaves the next file's commit sheet and draft intact"
    : "a late create result clears the submitted file and its reopened sheet";
  test(title, async ({ page, oauth, github }) => {
    mockCreation(github);
    let writing = false;
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    github.use(
      githubGraphql.mutation("CommitFileEdit", async () => {
        writing = true;
        await pending;
        return HttpResponse.json({ data: fileEdit.committedFile });
      }),
    );
    await signIn(page, oauth);
    const href = `${REPO}/new/main`;
    await openInApp(page, href);
    const path = page.getByRole("textbox", { name: enCode["create.pathLabel"] });
    await path.fill("first.txt");
    const editor = page.getByRole("textbox", { name: enCode["create.editorLabel"] });
    await editor.fill("submitted notes");
    await expect.poll(async () => JSON.stringify(await dumpIndexedDb(page))).toContain("first.txt");
    await openCommitSheet(page);
    await tapInSheet(page.getByText(enCode["commit.direct"].replace("{branch}", "main")));
    await submitCommit(page);
    await expect.poll(() => writing).toBe(true);
    const sheet = page.getByRole("dialog", { name: enCode["create.commitTitle"] });
    try {
      await tapInSheet(sheet.getByRole("button", { name: "Close" }));
      await expect(sheet).toHaveCount(0);
      if (changePath) await path.fill("second.txt");
      await page.getByRole("button", { name: enCode["edit.commit"], exact: true }).click();
      await expect(sheet).toBeVisible();
    } finally {
      finish?.();
    }
    await expect(page.getByText(enCode["create.done"], { exact: true })).toBeVisible();
    await expect(page).toHaveURL(href);
    if (changePath) {
      await expect(sheet).toBeVisible();
      await tapInSheet(sheet.getByRole("button", { name: "Close" }));
      await expect(path).toHaveValue("second.txt");
      await expect
        .poll(async () => JSON.stringify(await dumpIndexedDb(page)))
        .toContain("second.txt");
    } else {
      await expect(sheet).toHaveCount(0);
      await expect(path).toHaveValue("");
      await expect(editor).toHaveText("");
      await expect
        .poll(async () => JSON.stringify(await dumpIndexedDb(page)))
        .not.toContain("first.txt");
    }
  });
}
