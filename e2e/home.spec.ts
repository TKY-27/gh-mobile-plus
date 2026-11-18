import { http, HttpResponse } from "msw";
import enHome from "../src/i18n/messages/en/home.json" with { type: "json" };
import releases from "../src/data/home/fixtures/releases.json" with { type: "json" };
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";

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

test("Home links to the profile, recent repositories, activity and starred releases", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    githubGraphql.query("StarredReleases", () => HttpResponse.json({ data: recentReleases() })),
  );
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  await expect(home.getByRole("link", { name: /Mona Lisa/ })).toHaveAttribute("href", "/mona");
  await expect(home.getByRole("img", { name: /42 contributions/ })).toBeVisible();
  const recent = home.getByRole("region", { name: enHome["repositories.title"] });
  await expect(recent.getByRole("link", { name: /pocket-reader/ })).toHaveAttribute(
    "href",
    "/mona/pocket-reader",
  );
  await expect(recent.getByRole("link", { name: enHome["repositories.seeAll"] })).toHaveAttribute(
    "href",
    "/repositories",
  );
  await expect(home.getByRole("heading", { name: enHome["feed.title"] })).toBeVisible();
  await expect(home.getByRole("list", { name: enHome["feed.title"] })).toContainText(
    "starred octo-org/hello-mobile",
  );
  await expect(home.getByText(enHome["feed.delayNote"], { exact: false })).toBeVisible();
  await home
    .getByRole("combobox", { name: enHome["feed.filter.label"] })
    .selectOption({ label: enHome["releases.starred"] });
  await expect(home.getByRole("heading", { name: enHome["releases.title"] })).toBeVisible();
  await expect(home.getByRole("link", { name: /octo-org\/hello-mobile v1\.0\.0/ })).toBeVisible();
});

test("activity filters narrow the feed", async ({ page, oauth }) => {
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const feed = home.getByRole("list", { name: enHome["feed.title"] });
  await expect(feed).toBeVisible();
  const picker = home.getByRole("combobox", { name: enHome["feed.filter.label"] });
  await picker.selectOption({ label: enHome["feed.filter.stars"] });
  await expect(feed).toContainText("starred");
  await expect(feed).not.toContainText("issue #");
  await expect(picker).toBeInViewport({ ratio: 1 });
  await picker.selectOption({ label: enHome["feed.filter.follows"] });
  await expect(home.getByRole("heading", { name: enHome["feed.emptyFilter.title"] })).toBeVisible();
});

test("pushes show a branch and count only when the whole group supports them", async ({
  page,
  oauth,
  github,
}) => {
  const actor = { login: "mona", avatar_url: "https://avatars.githubusercontent.com/u/1" };
  const events = [
    { name: "reader", ref: "main", size: 3 },
    { name: "reader", ref: "main", size: undefined },
    { name: "themes", ref: "main", size: 3 },
    { name: "themes", ref: "fixes", size: 1 },
    { name: "docs", ref: "notes", size: 1 },
    { name: "docs", ref: "notes", size: 2 },
  ].map(({ name, ref, size }, index) => ({
    id: String(index + 1),
    actor,
    type: "PushEvent",
    repo: { name: `mona/${name}` },
    created_at: "2026-11-17T10:00:00Z",
    payload: { ref: `refs/heads/${ref}`, size },
  }));
  github.use(http.get(`${API_ORIGIN}/users/mona/received_events`, () => HttpResponse.json(events)));
  await signIn(page, oauth);
  const feed = page.getByRole("list", { name: enHome["feed.title"] });
  await expect(feed.getByRole("link", { name: /pushed to main in mona\/reader$/ })).toBeVisible();
  await expect(feed.getByRole("link", { name: /pushed to mona\/themes$/ })).toBeVisible();
  await expect(
    feed.getByRole("link", { name: /pushed 3 commits to notes in mona\/docs$/ }),
  ).toBeVisible();
});
