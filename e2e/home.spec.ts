import { HttpResponse } from "msw";
import enHome from "../src/i18n/messages/en/home.json" with { type: "json" };
import releases from "../src/data/home/fixtures/releases.json" with { type: "json" };
import { expect, githubGraphql, signIn, test } from "./support/github.ts";

const HOUR_MS = 3_600_000;

// Fixture dates age out of 14 days.
function recentReleases() {
  const publishedAt = new Date(Date.now() - HOUR_MS).toISOString();
  return {
    viewer: {
      starredRepositories: {
        nodes: releases.viewer.starredRepositories.nodes.map((repository) => ({
          ...repository,
          releases: {
            nodes: repository.releases.nodes.map((release) => ({ ...release, publishedAt })),
          },
        })),
      },
    },
  };
}

test("Home shows the profile, new releases and activity", async ({ page, oauth, github }) => {
  github.use(
    githubGraphql.query("StarredReleases", () => HttpResponse.json({ data: recentReleases() })),
  );
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const profile = home.getByRole("region", { name: enHome["profile.title"] });
  await expect(profile.getByRole("link", { name: /Mona Lisa/ })).toHaveAttribute("href", "/mona");
  await expect(profile.getByRole("img", { name: /42 contributions/ })).toBeVisible();
  await expect(home.getByRole("heading", { name: enHome["releases.title"] })).toBeVisible();
  await expect(home.getByRole("link", { name: /octo-org\/hello-mobile v1\.0\.0/ })).toBeVisible();
  await expect(home.getByRole("heading", { name: enHome["feed.title"] })).toBeVisible();
  await expect(home.getByRole("list", { name: enHome["feed.title"] })).toContainText(
    "starred octo-org/hello-mobile",
  );
  await expect(home.getByText(enHome["feed.delayNote"])).toBeVisible();
});

test("activity filters narrow the feed", async ({ page, oauth }) => {
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const feed = home.getByRole("list", { name: enHome["feed.title"] });
  await expect(feed).toBeVisible();
  await home.getByRole("radio", { name: enHome["feed.filter.stars"] }).click();
  await expect(feed).toContainText("starred");
  await expect(feed).not.toContainText("issue #");
  const follows = home.getByRole("radio", { name: enHome["feed.filter.follows"] });
  await expect(follows).toBeInViewport({ ratio: 1 });
  await follows.click();
  await expect(home.getByRole("heading", { name: enHome["feed.emptyFilter.title"] })).toBeVisible();
});
