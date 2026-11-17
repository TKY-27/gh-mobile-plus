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
