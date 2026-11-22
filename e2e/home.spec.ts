import { http, HttpResponse } from "msw";
import enHome from "../src/i18n/messages/en/home.json" with { type: "json" };
import enWork from "../src/i18n/messages/en/work.json" with { type: "json" };
import releases from "../src/data/home/fixtures/releases.json" with { type: "json" };
import workQueue from "../src/data/work/fixtures/queue.json" with { type: "json" };
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
  await expect(home.getByRole("radio", { name: enHome.overview })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(home.getByRole("img", { name: /42 contributions/ })).toBeInViewport();
  const recent = home.getByRole("region", { name: enHome["repositories.title"] });
  await expect(recent.getByRole("link", { name: /pocket-reader/ })).toHaveAttribute(
    "href",
    "/mona/pocket-reader",
  );
  await expect(recent.getByRole("link", { name: enHome["repositories.seeAll"] })).toHaveAttribute(
    "href",
    "/repositories",
  );
  await home.getByRole("radio", { name: enHome.following }).click();
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
  await home.getByRole("radio", { name: enHome.following }).click();
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

test("a failed activity refresh keeps the timeline and offers retry", async ({
  page,
  oauth,
  github,
}) => {
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  await home.getByRole("radio", { name: enHome.following }).click();
  const feed = home.getByRole("list", { name: enHome["feed.title"] });
  await expect(feed).toContainText("starred octo-org/hello-mobile");
  github.use(
    http.get(
      `${API_ORIGIN}/users/mona/received_events`,
      () => HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      { once: true },
    ),
  );
  await home.getByRole("button", { name: enHome.refresh }).click();
  await expect(feed).toContainText("starred octo-org/hello-mobile");
  await home.getByRole("alert").getByRole("button", { name: "Retry" }).click();
  await expect(home.getByRole("alert")).toHaveCount(0);
  await expect(feed).toContainText("starred octo-org/hello-mobile");
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
  await page.getByRole("radio", { name: enHome.following }).click();
  const feed = page.getByRole("list", { name: enHome["feed.title"] });
  await expect(feed.getByRole("link", { name: /pushed to main in mona\/reader$/ })).toBeVisible();
  await expect(feed.getByRole("link", { name: /pushed to mona\/themes$/ })).toBeVisible();
  await expect(
    feed.getByRole("link", { name: /pushed 3 commits to notes in mona\/docs$/ }),
  ).toBeVisible();
});

test("Home work cards open their matching queues without changing the five tabs", async ({
  page,
  oauth,
}) => {
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const work = home.getByRole("region", { name: enHome["work.title"] });
  const contributions = home.getByRole("region", { name: enHome["profile.calendarTitle"] });
  await expect(contributions).toBeVisible();
  const calendar = await contributions.boundingBox();
  const workBox = await work.boundingBox();
  expect(calendar).not.toBeNull();
  expect(workBox).not.toBeNull();
  expect(calendar?.y).toBeLessThan(workBox?.y ?? 0);
  const shortcuts = [
    { id: "myPrs", label: enWork["segment.myPrs"], count: "1" },
    { id: "reviewRequested", label: enWork["segment.reviewRequested"], count: "70" },
    { id: "assigned", label: enWork["segment.assigned"], count: "2" },
    { id: "ciFailing", label: enWork["segment.ciFailing"], count: "1" },
  ];
  for (const shortcut of shortcuts) {
    const link = work.getByRole("link", { name: new RegExp(shortcut.label) });
    await expect(link).toContainText(shortcut.count);
    await link.click();
    await expect(page).toHaveURL(`/pulls?segment=${shortcut.id}`);
    const queue = page.locator('[data-stack-screen^="/pulls"]');
    await expect(
      queue.getByRole("radio", { name: new RegExp(`^${shortcut.label}`) }),
    ).toHaveAttribute("aria-checked", "true");
    await page.locator('[data-tab="home"]').click();
  }
  for (const tab of ["home", "repositories", "work", "search", "account"]) {
    await expect(page.locator(`[data-tab="${tab}"]`)).toBeVisible();
  }
  await home.getByRole("button", { name: enHome["following.open"] }).click();
  await expect(home.getByRole("list", { name: enHome["feed.title"] })).toBeInViewport();
  await home.getByRole("link", { name: enHome["notifications.open"] }).click();
  await expect(page).toHaveURL("/notifications");
});

test("Home does not invent zero work counts after a failed load", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    githubGraphql.query(
      "WorkQueue",
      () => HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 }),
      { once: true },
    ),
  );
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const work = home.getByRole("region", { name: enHome["work.title"] });
  await expect(work.getByRole("alert")).toBeVisible();
  await expect(work.getByRole("link")).toHaveCount(0);
  await expect(home.getByRole("img", { name: /42 contributions/ })).toBeVisible();
  await work.getByRole("button", { name: "Retry" }).click();
  await expect(work.getByRole("link")).toHaveCount(4);
  await expect(work.getByRole("alert")).toHaveCount(0);
});

test("Home refresh updates work counts and keeps them on a later failure", async ({
  page,
  oauth,
  github,
}) => {
  await signIn(page, oauth);
  const home = page.locator('[data-stack-screen="/"]');
  const work = home.getByRole("region", { name: enHome["work.title"] });
  const myPrs = work.getByRole("link", { name: new RegExp(enWork["segment.myPrs"]) });
  await expect(myPrs).toContainText("1");
  github.use(
    githubGraphql.query("WorkQueue", () =>
      HttpResponse.json({ data: { ...workQueue, myPrs: { ...workQueue.myPrs, issueCount: 3 } } }),
    ),
  );
  await home.getByRole("button", { name: enHome.refresh }).click();
  await expect(myPrs).toContainText("3");
  github.use(
    githubGraphql.query(
      "WorkQueue",
      () => HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 }),
      { once: true },
    ),
  );
  await home.getByRole("button", { name: enHome.refresh }).click();
  await expect(work.getByRole("alert")).toBeVisible();
  await expect(myPrs).toContainText("3");
  await work.getByRole("button", { name: "Retry" }).click();
  await expect(work.getByRole("alert")).toHaveCount(0);
});
