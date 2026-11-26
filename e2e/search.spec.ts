import { HttpResponse } from "msw";
import enSearch from "../src/i18n/messages/en/search.json" with { type: "json" };
import repositories from "../src/data/search/fixtures/repositories.json" with { type: "json" };
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

test.beforeEach(async ({ page, oauth, github }) => {
  const lastPage = {
    data: {
      search: {
        ...repositories.data.search,
        pageInfo: { endCursor: null, hasNextPage: false },
      },
    },
  };
  github.use(githubGraphql.query("Search", () => HttpResponse.json(lastPage)));
  await signIn(page, oauth);
  await openInApp(page, "/search");
});

test("a pasted GitHub link offers a direct jump", async ({ page }) => {
  const screen = page.locator('[data-stack-screen="/search"]');
  await screen.getByRole("searchbox").fill("https://github.com/octo-org/hello-mobile/pull/12");
  await screen.getByRole("link", { name: "Open octo-org/hello-mobile/pull/12" }).click();
  await expect(page).toHaveURL("/octo-org/hello-mobile/pull/12");
});

test("owner/repo#n offers a jump to the issue", async ({ page }) => {
  const screen = page.locator('[data-stack-screen="/search"]');
  await screen.getByRole("searchbox").fill("octo-org/hello-mobile#7");
  await expect(
    screen.getByRole("link", { name: "Open octo-org/hello-mobile/issues/7" }),
  ).toBeVisible();
});

test("searches show results and are remembered until cleared", async ({ page }) => {
  const screen = page.locator('[data-stack-screen="/search"]');
  const field = screen.getByRole("searchbox");
  await field.fill("mobile");
  await field.press("Enter");
  await expect(screen.getByRole("link", { name: /octo-org\/hello-mobile/ }).first()).toBeVisible();
  await expect(screen.getByText("32 results")).toBeVisible();
  await field.clear();
  await expect(screen.getByRole("heading", { name: enSearch["recent.title"] })).toBeVisible();
  await screen.getByRole("button", { name: enSearch["recent.clear"] }).click();
  await expect(screen.getByRole("heading", { name: enSearch["recent.title"] })).toHaveCount(0);
  await expect(screen.getByRole("heading", { name: enSearch["start.title"] })).toBeVisible();
});

test("code search explains its API syntax and rate limit", async ({ page }) => {
  const screen = page.locator('[data-stack-screen="/search"]');
  await screen.getByRole("radio", { name: enSearch["scope.code"] }).click();
  await expect(screen.getByText(enSearch.codeNote)).toBeVisible();
  await screen.getByRole("button", { name: "repo:", exact: true }).click();
  await expect(screen.getByRole("searchbox")).toHaveValue("repo:");
  await expect(screen.getByRole("searchbox")).toBeFocused();
});

test("PR search shows a different icon and color for each state", async ({ page, github }) => {
  const states = [
    {
      label: "Open",
      state: "OPEN",
      draft: false,
      icon: "git-pull-request",
      color: "rgb(76, 194, 110)",
    },
    {
      label: "Draft",
      state: "OPEN",
      draft: true,
      icon: "git-pull-request-draft",
      color: "rgb(155, 155, 163)",
    },
    {
      label: "Merged",
      state: "MERGED",
      draft: false,
      icon: "git-merge",
      color: "rgb(180, 140, 255)",
    },
    {
      label: "Closed",
      state: "CLOSED",
      draft: false,
      icon: "git-pull-request-closed",
      color: "rgb(255, 122, 112)",
    },
  ];
  await page.emulateMedia({ colorScheme: "dark" });
  github.use(
    githubGraphql.query("Search", () =>
      HttpResponse.json({
        data: {
          search: {
            issueCount: states.length,
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: states.map(({ label, state, draft }, index) => ({
              __typename: "PullRequest",
              number: index + 1,
              title: `${label} fixture`,
              pullRequestState: state,
              isDraft: draft,
              updatedAt: "2026-11-16T12:00:00Z",
              repository: { name: "hello-mobile", owner: { login: "octo-org" } },
            })),
          },
        },
      }),
    ),
  );
  const screen = page.locator('[data-stack-screen="/search"]');
  await screen.getByRole("radio", { name: enSearch["scope.issues"] }).click();
  const field = screen.getByRole("searchbox");
  await field.fill("is:pr");
  await field.press("Enter");

  for (const { label, icon, color } of states) {
    const row = screen.getByRole("link", { name: new RegExp(`${label} fixture`) });
    const stateIcon = row.getByRole("img", { name: `${label} pull request`, exact: true });
    await expect(stateIcon).toHaveClass(new RegExp(`\\blucide-${icon}\\b`));
    await expect(stateIcon).toHaveCSS("color", color);
  }
});

test("a qualifier completes the current term and keeps the search editable", async ({ page }) => {
  const screen = page.locator('[data-stack-screen="/search"]');
  const field = screen.getByRole("searchbox");
  await field.fill("mobile lang");
  await screen.getByRole("button", { name: "language:TypeScript", exact: true }).click();
  await expect(field).toHaveValue("mobile language:TypeScript ");
  await expect(field).toBeFocused();
  await field.press("Enter");
  await expect(screen.getByText("32 results")).toBeVisible();
  await field.clear();
  await expect(
    screen.getByRole("button", { name: /mobile language:TypeScript.*Repositories/ }),
  ).toBeVisible();
});

test("search results sort picker updates options and re-queries with sort qualifier", async ({
  page,
  github,
}) => {
  const queries: string[] = [];
  github.use(
    githubGraphql.query<object, { query: string }>("Search", ({ variables }) => {
      queries.push(variables.query);
      return HttpResponse.json({
        data: {
          search: {
            repositoryCount: 1,
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [
              {
                __typename: "Repository",
                owner: { login: "octo-org" },
                name: "hello-mobile",
                description: "A mobile GitHub client fixture",
                isPrivate: false,
                isFork: false,
                stargazerCount: 128,
                primaryLanguage: { name: "TypeScript", color: "#3178c6" },
                updatedAt: "2026-11-16T10:30:00Z",
              },
            ],
          },
        },
      });
    }),
  );
  const screen = page.locator('[data-stack-screen="/search"]');
  const field = screen.getByRole("searchbox");
  await field.fill("mobile");
  await field.press("Enter");
  const sortSelect = screen.getByRole("combobox", { name: "Sort results" });
  await expect(sortSelect).toHaveValue("bestMatch");
  await sortSelect.selectOption("stars");
  await expect(sortSelect).toHaveValue("stars");
  expect(queries.at(-1)).toBe("mobile sort:stars-desc");
});
