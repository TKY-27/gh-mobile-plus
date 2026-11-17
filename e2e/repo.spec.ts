import type { Page } from "@playwright/test";
import { HttpResponse } from "msw";
import file from "../src/data/repo/fixtures/file.json" with { type: "json" };
import refs from "../src/data/repo/fixtures/refs.json" with { type: "json" };
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import tree from "../src/data/repo/fixtures/tree.json" with { type: "json" };
import enCode from "../src/i18n/messages/en/code.json" with { type: "json" };
import enRepo from "../src/i18n/messages/en/repo.json" with { type: "json" };
import { tapInSheet } from "./support/accounts.ts";
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

const REPO = "/octo-org/hello-mobile";
const HEAD_OID = file.data.repository.head.oid;

async function recordClipboard(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "copiedTexts", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

test.beforeEach(({ github }) => {
  github.use(
    githubGraphql.operation(() =>
      HttpResponse.json({ errors: [{ message: "Outside this test" }] }),
    ),
  );
  github.use(
    githubGraphql.query("Repository", () => HttpResponse.json(repository)),
    githubGraphql.query("RepositoryRefs", () => HttpResponse.json(refs)),
    githubGraphql.query("RepositoryTree", () => HttpResponse.json(tree)),
    githubGraphql.query("RepositoryFile", () => HttpResponse.json(file)),
  );
});

test("shows the repository header and README", async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openInApp(page, REPO);

  const screen = page.locator(`[data-stack-screen="${REPO}"]`);
  await expect(screen.getByRole("heading", { level: 1, name: "hello-mobile" })).toBeVisible();
  await expect(screen.getByRole("link", { name: "octo-org", exact: true })).toBeVisible();
  await expect(screen.getByText("A small mobile-friendly project.")).toBeVisible();
  await expect(screen.getByText("42 stars")).toBeAttached();
  await expect(screen.getByText("MIT License")).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Hello Mobile" })).toBeVisible();
});

test("starring is optimistic and sends the mutation", async ({ page, oauth, github }) => {
  const starred: unknown[] = [];
  github.use(
    githubGraphql.query("Repository", () =>
      HttpResponse.json({
        data: {
          repository: { ...repository.data.repository, viewerHasStarred: starred.length > 0 },
        },
      }),
    ),
    githubGraphql.mutation("StarRepository", ({ variables }) => {
      starred.push(variables);
      return HttpResponse.json({ data: { addStar: { clientMutationId: null } } });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, REPO);

  const star = page.getByRole("button", { name: enRepo.star, exact: true });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => starred).toEqual([{ id: repository.data.repository.id }]);
});

test("browses the tree to a file and copies its permalink", async ({ page, oauth }) => {
  await recordClipboard(page);
  await signIn(page, oauth);
  await openInApp(page, REPO);

  await page.getByRole("link", { name: new RegExp(enRepo["sections.code"]) }).click();
  await expect(page).toHaveURL(`${REPO}/tree/refs%2Fheads%2Fmain`);
  await page.getByRole("link", { name: /alpha\.ts/ }).click();
  const filePath = `${REPO}/blob/refs%2Fheads%2Fmain/src/alpha.ts`;
  await expect(page).toHaveURL(filePath);
  await expect(page.getByText("export const hello = true;")).toBeVisible();

  const fileScreen = page.locator(`[data-stack-screen="${filePath}"]`);
  await fileScreen.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: enCode["permalink.copy"] }).click();
  await expect(
    page.getByRole("status").filter({ hasText: enCode["permalink.copied"] }),
  ).toBeVisible();
  const copied = await page.evaluate(() => {
    const texts: unknown = Reflect.get(window, "copiedTexts");
    return texts;
  });
  expect(copied).toEqual([
    `https://github.com/octo-org/hello-mobile/blob/${HEAD_OID}/src/alpha.ts`,
  ]);
});

test("the breadcrumb switches the file to another branch", async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/blob/main/src/alpha.ts`);

  await page
    .getByRole("button", { name: enRepo["refs.switchFrom"].replace("{ref}", "main") })
    .click();
  const sheet = page.getByRole("dialog", { name: enRepo["refs.title"] });
  const filter = sheet.getByRole("searchbox", { name: enRepo["refs.filter"] });
  await tapInSheet(filter);
  await filter.fill("navigation");
  await expect(sheet.getByRole("button", { name: "release" })).toHaveCount(0);
  await tapInSheet(sheet.getByRole("button", { name: "feature/navigation" }));

  await expect(page).toHaveURL(`${REPO}/blob/refs%2Fheads%2Ffeature%2Fnavigation/src/alpha.ts`);
  await expect(
    page.getByRole("button", {
      name: enRepo["refs.switchFrom"].replace("{ref}", "feature/navigation"),
    }),
  ).toBeVisible();
});

test("resolves a longer branch before reading a valid shorter tag", async ({
  page,
  oauth,
  github,
}) => {
  const expressions: unknown[] = [];
  const fixture = refs.data.repository;
  const correctExpression = "refs/heads/release/mobile:src/alpha.ts";
  const shorterTagFile = {
    data: {
      repository: {
        ...file.data.repository,
        branch: null,
        object: { ...file.data.repository.object, text: "content from the release tag" },
      },
    },
  };
  github.use(
    githubGraphql.query("RepositoryRefs", () =>
      HttpResponse.json({
        data: {
          repository: {
            ...fixture,
            branches: { ...fixture.branches, nodes: [{ name: "release/mobile" }] },
            tags: { ...fixture.tags, nodes: [{ name: "release" }] },
          },
        },
      }),
    ),
    githubGraphql.query("RepositoryFile", ({ variables }) => {
      expressions.push(variables.expression);
      return HttpResponse.json(variables.expression === correctExpression ? file : shorterTagFile);
    }),
  );
  await signIn(page, oauth);
  await page.goto(`${REPO}/blob/release/mobile/src/alpha.ts#L1`);

  await expect(page).toHaveURL(`${REPO}/blob/refs%2Fheads%2Frelease%2Fmobile/src/alpha.ts#L1`);
  await expect(page.getByText("export const hello = true;")).toBeVisible();
  await expect(page.getByRole("button", { name: enCode["edit.action"] })).toBeVisible();
  expect([...new Set(expressions)]).toEqual([correctExpression]);
});

test("switches between a branch and a tag with the same name", async ({ page, oauth, github }) => {
  const fixture = refs.data.repository;
  const taggedText = "content from the main tag";
  github.use(
    githubGraphql.query("RepositoryRefs", () =>
      HttpResponse.json({
        data: {
          repository: {
            ...fixture,
            tags: { ...fixture.tags, nodes: [{ name: "main" }] },
          },
        },
      }),
    ),
    githubGraphql.query("RepositoryFile", ({ variables }) =>
      HttpResponse.json(
        variables.expression === "refs/tags/main:src/alpha.ts"
          ? {
              data: {
                repository: {
                  ...file.data.repository,
                  object: { ...file.data.repository.object, text: taggedText },
                },
              },
            }
          : file,
      ),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/blob/refs%2Fheads%2Fmain/src/alpha.ts`);
  const switchRef = page.getByRole("button", {
    name: enRepo["refs.switchFrom"].replace("{ref}", "main"),
  });
  await switchRef.click();
  const sheet = page.getByRole("dialog", { name: enRepo["refs.title"] });
  const tags = sheet.getByRole("radio", { name: enRepo["refs.tags"] });
  await tapInSheet(tags);
  await expect(tags).toBeChecked();
  await tapInSheet(sheet.getByRole("button", { name: "main", exact: true }));

  await expect(page).toHaveURL(`${REPO}/blob/refs%2Ftags%2Fmain/src/alpha.ts`);
  await expect(page.getByText(taggedText)).toBeVisible();
  await expect(page.getByRole("button", { name: enCode["edit.action"] })).toHaveCount(0);
  await expect(sheet).toBeHidden();
  await switchRef.click();
  await expect(tags).toBeChecked();
});

test("repairs a pasted tree URL at the root of a slash-named branch", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    githubGraphql.query("RepositoryTree", ({ variables }) =>
      variables.expression === "refs/heads/feature/navigation:"
        ? HttpResponse.json(tree)
        : HttpResponse.json({ data: { repository: { object: null } } }),
    ),
  );
  await signIn(page, oauth);
  await page.goto(`${REPO}/tree/feature/navigation`);

  await expect(page).toHaveURL(`${REPO}/tree/refs%2Fheads%2Ffeature%2Fnavigation`);
  await expect(page.getByRole("link", { name: /alpha\.ts/ })).toBeVisible();
});
