import { http, HttpResponse } from "msw";
import profile from "../src/data/users/fixtures/profile.json" with { type: "json" };
import { openAccountScreen } from "./support/accounts.ts";
import { GITHUB_HTML_MEDIA_TYPE } from "./support/fixtures.ts";
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";

const PROFILE = profile.data.repositoryOwner;

test("a missing profile repository leaves Account and the Home profile usable", async ({
  page,
  oauth,
  github,
}) => {
  const errors = [
    {
      type: "NOT_FOUND",
      path: ["repositoryOwner", "repository"],
      message: "Could not resolve to a Repository with the name 'mona/mona'.",
    },
  ];
  github.use(
    githubGraphql.query("Profile", () =>
      HttpResponse.json({
        data: { repositoryOwner: { ...PROFILE, repository: null } },
        errors,
      }),
    ),
  );

  await signIn(page, oauth);
  await openAccountScreen(page);
  await expect(page.getByText(PROFILE.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Repositories/ })).toHaveAttribute(
    "href",
    "/mona?tab=repositories",
  );
  await page.locator('[data-tab="home"]').click();
  await page.getByRole("link", { name: /Mona Lisa/ }).click();
  await expect(page).toHaveURL("/mona");
  const ownerScreen = page.locator('[data-stack-screen="/mona"]');
  await expect(ownerScreen.getByText(PROFILE.name, { exact: true })).toBeVisible();
  expect(github.requests.some(({ url }) => url.endsWith("/repos/mona/mona/readme"))).toBe(false);
});

test("Account shows the profile while GitHub is still rendering its README", async ({
  page,
  oauth,
  github,
}) => {
  let releaseReadme: (() => void) | undefined;
  const readmeBlocked = new Promise<void>((resolve) => {
    releaseReadme = resolve;
  });
  const readmePath = "/repos/mona/mona/readme";
  github.use(
    http.get(`${API_ORIGIN}${readmePath}`, async () => {
      await readmeBlocked;
      return HttpResponse.text("<p>Profile README content</p>", {
        headers: { "Content-Type": GITHUB_HTML_MEDIA_TYPE },
      });
    }),
  );

  await signIn(page, oauth);
  try {
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === readmePath),
      openAccountScreen(page),
    ]);
    await expect(page.getByText(PROFILE.name, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  } finally {
    releaseReadme?.();
  }
  await expect(page.getByText("Profile README content")).toBeVisible();

  github.use(
    githubGraphql.query("Profile", () =>
      HttpResponse.json({
        data: { repositoryOwner: { ...PROFILE, repository: { isPrivate: true } } },
      }),
    ),
  );
  // Reopening a stale profile checks visibility.
  await page.clock.setFixedTime(new Date(Date.now() + 120_000));
  await page.locator('[data-tab="home"]').click();
  await page.getByRole("link", { name: /Mona Lisa/ }).click();
  await expect(page).toHaveURL("/mona");
  const ownerScreen = page.locator('[data-stack-screen="/mona"]');
  await expect(ownerScreen.getByText(PROFILE.name, { exact: true })).toBeVisible();
  await expect(ownerScreen.getByText("Profile README content")).toBeHidden();
});

test("the repositories tab finds a fork by name in the signed-in account", async ({
  page,
  oauth,
  github,
}) => {
  const searches: string[] = [];
  github.use(
    githubGraphql.query<object, { query: string }>("Search", ({ variables }) => {
      searches.push(variables.query);
      return HttpResponse.json({
        data: {
          search: {
            repositoryCount: 1,
            nodes: [
              {
                ...PROFILE.pinnedItems.nodes[0],
                owner: { login: "mona" },
                name: "archived-fork",
                isFork: true,
              },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      });
    }),
  );
  await signIn(page, oauth);
  await page.locator('[data-tab="repositories"]').click();
  await expect(page).toHaveURL("/repositories");
  const screen = page.locator('[data-stack-screen="/repositories"]');
  const original = screen.getByRole("link", { name: /hello-mobile/ });
  await expect(original).toHaveAttribute("href", "/mona/hello-mobile");
  const field = screen.getByRole("searchbox");
  await field.fill("archived-fork");
  await expect(screen.getByRole("link", { name: /archived-fork/ })).toHaveAttribute(
    "href",
    "/mona/archived-fork",
  );
  expect(searches).toHaveLength(1);
  for (const clause of ["user:mona", "in:name", "fork:true", "archived-fork"]) {
    expect(searches[0]).toContain(clause);
  }
  await field.clear();
  await expect(original).toBeVisible();
  await page.context().setOffline(true);
  await field.fill("archived-fork");
  await expect(screen.getByRole("link", { name: /archived-fork/ })).toBeVisible();
  expect(searches).toHaveLength(1);
});

test("offline name filtering searches saved repositories and reports a partial list", async ({
  page,
  context,
  oauth,
  github,
}) => {
  const nodes = Array.from({ length: 50 }, (_, index) => ({
    ...PROFILE.pinnedItems.nodes[0],
    owner: { login: "mona" },
    name: index === 0 ? "Saved-Fork" : `project-${String(index)}`,
  }));
  github.use(
    githubGraphql.query("RepositoriesOf", () =>
      HttpResponse.json({
        data: {
          repositoryOwner: {
            __typename: "User",
            repositories: { nodes, pageInfo: { endCursor: "next", hasNextPage: true } },
          },
        },
      }),
    ),
  );
  await signIn(page, oauth);
  await page.locator('[data-tab="repositories"]').click();
  const screen = page.locator('[data-stack-screen="/repositories"]');
  const fork = screen.getByRole("link", { name: /Saved-Fork/ });
  const project = screen.getByRole("link", { name: /project-1\b/ });
  await expect(project).toBeVisible();
  await context.setOffline(true);
  const field = screen.getByRole("searchbox");
  await field.fill("saved-fork");
  await expect(fork).toHaveAttribute("href", "/mona/Saved-Fork");
  await expect(project).toHaveCount(0);
  await expect(screen.getByRole("status")).toContainText("Only repositories saved on this device");
  await field.fill("missing-fork");
  await expect(
    screen.getByRole("heading", { name: "No saved repositories match “missing-fork”" }),
  ).toBeVisible();
  await screen.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(project).toBeVisible();
  await context.setOffline(false);
  await expect(screen.getByRole("combobox", { name: "Sort repositories" })).toHaveValue("updated");
});

test("repository list sort picker updates options and re-queries with the selected order", async ({
  page,
  oauth,
  github,
}) => {
  const orders: unknown[] = [];
  github.use(
    githubGraphql.query<object, { repoOrder?: { field: string; direction: string } }>(
      "RepositoriesOf",
      ({ variables }) => {
        orders.push(variables.repoOrder);
        return HttpResponse.json({
          data: {
            repositoryOwner: {
              __typename: "User",
              repositories: {
                nodes: [PROFILE.pinnedItems.nodes[0]],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          },
        });
      },
    ),
  );
  await signIn(page, oauth);
  await page.locator('[data-tab="repositories"]').click();
  const screen = page.locator('[data-stack-screen="/repositories"]');
  const sortSelect = screen.getByRole("combobox", { name: "Sort repositories" });
  await expect(sortSelect).toHaveValue("updated");
  await sortSelect.selectOption("stars");
  await expect(sortSelect).toHaveValue("stars");
  expect(orders).toContainEqual({ field: "STARGAZERS", direction: "DESC" });
});
