import { HttpResponse } from "msw";
import pulls from "../src/data/issues/fixtures/pull-list.json" with { type: "json" };
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import enPull from "../src/i18n/messages/en/pull.json" with { type: "json" };
import enRepo from "../src/i18n/messages/en/repo.json" with { type: "json" };
import { tapInSheet } from "./support/accounts.ts";
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { inScreen, openInApp, REPO } from "./support/screens.ts";

const comparePath = `${REPO}/compare`;

test("compares two branches before opening a draft pull request", async ({
  page,
  oauth,
  github,
}) => {
  const comparisons: unknown[] = [];
  const submissions: unknown[] = [];
  github.use(
    githubGraphql.query("IssueList", () => HttpResponse.json(pulls)),
    githubGraphql.query("PullBranchComparison", ({ variables }) => {
      comparisons.push(variables);
      return HttpResponse.json({
        data: { repository: { id: "R_base", ref: { compare: { aheadBy: 2, behindBy: 1 } } } },
      });
    }),
    githubGraphql.mutation("OpenEditPullRequest", ({ variables }) => {
      submissions.push(variables.input);
      return HttpResponse.json({ data: { createPullRequest: { pullRequest: { number: 43 } } } });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/pulls`);
  await inScreen(page, `${REPO}/pulls`).getByRole("button", { name: enPull["new.screen"] }).click();
  const screen = inScreen(page, comparePath);
  await screen.getByLabel(enPull["new.title"], { exact: true }).fill("Mobile review");
  await screen.getByLabel(enPull["new.body"], { exact: true }).fill("Review these changes.");
  const head = screen.getByRole("button", { name: enPull["new.head"] });
  const branches = page.getByRole("dialog", { name: enRepo["refs.branches"] });
  await head.click();
  await tapInSheet(branches.getByRole("button", { name: "main", exact: true }));
  await expect(screen.getByRole("status")).toContainText(enPull["new.noChanges"]);
  await expect(
    screen.getByRole("button", { name: enPull["new.submit"], exact: true }),
  ).toBeDisabled();
  await head.click();
  await expect(branches.getByText("v1.0.0")).toHaveCount(0);
  await tapInSheet(branches.getByRole("button", { name: "feature/navigation", exact: true }));
  await expect(screen.getByRole("status")).toHaveText(
    enPull["new.summary"].replace("{ahead}", "2").replace("{behind}", "1"),
  );
  await screen.getByText(enPull["new.draft"], { exact: true }).click();
  expect(submissions).toEqual([]);
  await screen.getByRole("button", { name: enPull["new.submitDraft"], exact: true }).click();
  await expect(page).toHaveURL(`${REPO}/pull/43`);
  expect(comparisons).toEqual([
    {
      owner: "octo-org",
      repo: "hello-mobile",
      base: "refs/heads/main",
      head: "feature/navigation",
    },
  ]);
  expect(submissions).toEqual([
    {
      repositoryId: "R_base",
      baseRefName: "main",
      headRefName: "feature/navigation",
      title: "Mobile review",
      body: "Review these changes.",
      draft: true,
    },
  ]);
});

test("a deep link to an archived repository cannot submit a PR", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    githubGraphql.query("Repository", () =>
      HttpResponse.json({
        data: {
          repository: { ...repository.data.repository, isArchived: true },
        },
      }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, comparePath);
  const screen = inScreen(page, comparePath);
  await expect(screen.getByRole("heading", { name: enPull["new.unavailable"] })).toBeVisible();
  await expect(screen.getByRole("button", { name: enPull["new.submit"], exact: true })).toHaveCount(
    0,
  );
});

test("keeps the PR proposal across a failed repository refresh and retry", async ({
  page,
  oauth,
  github,
}) => {
  let rejectRefresh = false;
  let rejected = 0;
  github.use(
    githubGraphql.query("Repository", () => {
      if (rejectRefresh) {
        rejected++;
        return HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 });
      }
      return HttpResponse.json(repository);
    }),
    githubGraphql.query("PullBranchComparison", () =>
      HttpResponse.json({
        data: { repository: { id: "R_base", ref: { compare: { aheadBy: 3, behindBy: 1 } } } },
      }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, comparePath);
  const screen = inScreen(page, comparePath);
  const base = screen.getByRole("button", { name: enPull["new.base"] });
  const head = screen.getByRole("button", { name: enPull["new.head"] });
  const branches = page.getByRole("dialog", { name: enRepo["refs.branches"] });
  await base.click();
  await tapInSheet(branches.getByRole("button", { name: "release", exact: true }));
  await head.click();
  await tapInSheet(branches.getByRole("button", { name: "feature/navigation", exact: true }));
  const title = screen.getByLabel(enPull["new.title"], { exact: true });
  const body = screen.getByLabel(enPull["new.body"], { exact: true });
  await title.fill("Release notes");
  await body.fill("Prepared on mobile.");
  await screen.getByText(enPull["new.draft"], { exact: true }).click();
  rejectRefresh = true;
  await page.clock.setFixedTime(new Date(Date.now() + 120_000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
  );
  const error = screen.getByRole("alert");
  await expect(error).toContainText("permission");
  expect(rejected).toBeGreaterThan(0);
  await expect(title).toHaveValue("Release notes");
  rejectRefresh = false;
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(error).toBeHidden();
  await expect(base).toHaveText("release");
  await expect(head).toHaveText("feature/navigation");
  await expect(title).toHaveValue("Release notes");
  await expect(body).toHaveValue("Prepared on mobile.");
  await expect(screen.getByRole("switch", { name: enPull["new.draft"] })).toBeChecked();
  await expect(
    screen.getByRole("button", { name: enPull["new.submitDraft"], exact: true }),
  ).toBeEnabled();
});
