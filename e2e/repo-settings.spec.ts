import { http, HttpResponse } from "msw";
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import enRepo from "../src/i18n/messages/en/repo.json" with { type: "json" };
import enErrors from "../src/i18n/messages/en/errors.json" with { type: "json" };
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";
import { inScreen, openInApp, REPO } from "./support/screens.ts";

const settingsPath = `${REPO}/settings`;

test("keeps unsaved settings after rejection and patches only edited fields", async ({
  page,
  oauth,
  github,
}) => {
  const adminRepo = { ...repository.data.repository, viewerCanAdminister: true };
  const description = "Maintained on mobile";
  const patches: unknown[] = [];
  github.use(
    githubGraphql.query("Repository", () => HttpResponse.json({ data: { repository: adminRepo } })),
    http.patch(`${API_ORIGIN}/repos${REPO}`, async ({ request }) => {
      patches.push(await request.json());
      if (patches.length === 1)
        return HttpResponse.json({ message: "Validation failed" }, { status: 422 });
      adminRepo.description = description;
      adminRepo.hasWikiEnabled = true;
      return HttpResponse.json({
        description,
        homepage: null,
        has_issues: true,
        has_wiki: true,
        has_projects: true,
      });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, REPO);
  await page.getByRole("link", { name: enRepo["admin.title"] }).click();
  await expect(page).toHaveURL(settingsPath);
  const screen = inScreen(page, settingsPath);
  const save = screen.getByRole("button", { name: enRepo["admin.save"], exact: true });
  await expect(save).toBeDisabled();
  await screen.getByLabel(enRepo["admin.description"]).fill(description);
  await screen.getByText(enRepo["admin.has_wiki"], { exact: true }).click();
  await expect(screen.getByRole("switch", { name: enRepo["admin.has_wiki"] })).toBeChecked();
  await save.click();
  await expect(screen.getByRole("alert")).toContainText(enErrors["validation.title"]);
  await expect(screen.getByLabel(enRepo["admin.description"])).toHaveValue(description);
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: enRepo["admin.saved"] })).toBeVisible();
  expect(patches).toEqual([
    { description, has_wiki: true },
    { description, has_wiki: true },
  ]);
  await expect(save).toBeDisabled();
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await expect(inScreen(page, REPO).getByText(description)).toBeVisible();
});

test("does not expose administrative controls to a repository writer", async ({ page, oauth }) => {
  await signIn(page, oauth);
  await openInApp(page, REPO);
  await expect(
    inScreen(page, REPO).getByText(repository.data.repository.description),
  ).toBeVisible();
  await expect(inScreen(page, REPO).getByRole("link", { name: enRepo["admin.title"] })).toHaveCount(
    0,
  );
  await openInApp(page, settingsPath);
  await expect(
    inScreen(page, settingsPath).getByRole("heading", { name: enRepo["admin.readOnly"] }),
  ).toBeVisible();
  await expect(
    inScreen(page, settingsPath).getByRole("button", { name: enRepo["admin.save"] }),
  ).toHaveCount(0);
});

test("creates a private personal repository and opens it in the app", async ({
  page,
  oauth,
  github,
}) => {
  const name = "field-notes";
  const posts: unknown[] = [];
  github.use(
    http.post(`${API_ORIGIN}/user/repos`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({ owner: { login: "mona" }, name }, { status: 201 });
    }),
    githubGraphql.query("Repository", () =>
      HttpResponse.json({
        data: {
          repository: {
            ...repository.data.repository,
            name,
            owner: { login: "mona" },
            isPrivate: true,
          },
        },
      }),
    ),
    http.get(`${API_ORIGIN}/repos/mona/${name}/readme`, () =>
      HttpResponse.json({ message: "Not found" }, { status: 404 }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, "/repositories");
  await page.getByRole("link", { name: enRepo["create.title"] }).click();
  await expect(page).toHaveURL("/new");
  const screen = inScreen(page, "/new");
  await screen.getByLabel(enRepo["forking.name"]).fill(name);
  await screen.getByLabel(enRepo["admin.description"]).fill("Phone notes");
  await expect(screen.getByLabel(enRepo["create.visibility"])).toHaveValue("private");
  await screen.getByText(enRepo["create.readme"], { exact: true }).click();
  await screen.getByRole("button", { name: enRepo["create.submit"] }).click();
  await expect(page).toHaveURL("/mona/field-notes");
  await expect(
    inScreen(page, "/mona/field-notes").getByRole("heading", { level: 1, name }),
  ).toBeVisible();
  expect(posts).toEqual([{ name, description: "Phone notes", private: true, auto_init: true }]);
});

test("a public-only grant exposes public visibility only", async ({ page, oauth }) => {
  await oauth.configure({ user: "mona", consent: "approve" });
  await page.addInitScript(() => {
    localStorage.setItem("ghm-onboarding", "done");
  });
  await page.goto("/auth/login?mode=add&public=1");
  await expect(page).toHaveURL("/");
  await openInApp(page, "/new");
  const visibility = inScreen(page, "/new").getByLabel(enRepo["create.visibility"]);
  await expect(visibility).toBeDisabled();
  await expect(visibility).toHaveValue("public");
  await expect(visibility.getByRole("option", { name: enRepo.private })).toHaveCount(0);
});

test("submits a named fork and opens it after GitHub reports its branch", async ({
  page,
  oauth,
  github,
}) => {
  const name = "mobile-fork";
  const created = { name, owner: { login: "mona" } };
  const posts: unknown[] = [];
  let checks = 0;
  github.use(
    http.post(`${API_ORIGIN}/repos${REPO}/forks`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json(created, { status: 202 });
    }),
    githubGraphql.query("EditForkReady", () =>
      HttpResponse.json({
        data: {
          repository: {
            ...created,
            id: "R_mobile_fork",
            defaultBranchRef: checks++ === 0 ? null : { name: "main" },
          },
        },
      }),
    ),
    githubGraphql.query("Repository", ({ variables }) =>
      HttpResponse.json({
        data: {
          repository:
            variables.repo === name
              ? { ...repository.data.repository, ...created }
              : repository.data.repository,
        },
      }),
    ),
    http.get(`${API_ORIGIN}/repos/mona/${name}/readme`, () =>
      HttpResponse.json({ message: "Not found" }, { status: 404 }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, REPO);
  await inScreen(page, REPO).getByRole("button", { name: enRepo.fork, exact: true }).click();
  const screen = inScreen(page, `${REPO}/fork`);
  await screen.getByLabel(enRepo["forking.name"]).fill(name);
  await screen.getByRole("button", { name: enRepo["forking.create"], exact: true }).click();
  await screen.getByRole("link", { name: "Open mona/mobile-fork" }).click();
  await expect(page).toHaveURL("/mona/mobile-fork");
  await expect(
    inScreen(page, "/mona/mobile-fork").getByRole("heading", { level: 1, name }),
  ).toBeVisible();
  expect(posts).toEqual([{ name, default_branch_only: true }]);
  expect(checks).toBeGreaterThanOrEqual(2);
});

test("same-organization forks require a distinct name and respect policy denials", async ({
  page,
  oauth,
  github,
}) => {
  const posts: unknown[] = [];
  github.use(
    http.post(`${API_ORIGIN}/repos${REPO}/forks`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({ message: "Forking is disabled by policy" }, { status: 403 });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/fork`);
  const screen = inScreen(page, `${REPO}/fork`);
  const owner = screen.getByLabel(enRepo["forking.owner"]);
  await expect(owner.locator('option[value="octo-org"]')).toBeAttached();
  await owner.selectOption("octo-org");
  const submit = screen.getByRole("button", { name: enRepo["forking.create"] });
  await expect(submit).toBeDisabled();
  await expect(screen.getByText(enRepo["forking.uniqueName"])).toBeVisible();
  await screen.getByLabel(enRepo["forking.name"]).fill("team-fork");
  await submit.click();
  await expect(screen.getByRole("alert")).toContainText(enErrors["forbidden.title"]);
  expect(posts).toEqual([
    { name: "team-fork", organization: "octo-org", default_branch_only: true },
  ]);
});

test("does not offer the personal source or read-only organizations as fork destinations", async ({
  page,
  oauth,
  github,
}) => {
  const path = "/MONA/hello-mobile/fork";
  github.use(
    githubGraphql.query("ViewerOrganizations", () =>
      HttpResponse.json({
        data: {
          viewer: {
            organizations: {
              nodes: [
                {
                  login: "octo-org",
                  name: "Octo Organization",
                  avatarUrl: "",
                  viewerCanCreateRepositories: false,
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, path);
  const screen = inScreen(page, path);
  await expect(screen.getByText(enRepo["forking.noOwner"])).toBeVisible();
  await expect(screen.getByRole("button", { name: enRepo["forking.create"] })).toHaveCount(0);
});

test("keeps the confirmed repository settings when refreshing after save fails", async ({
  page,
  oauth,
  github,
}) => {
  const adminRepo = { ...repository.data.repository, viewerCanAdminister: true };
  const homepage = "https://example.test/";
  let saved = false;
  let rejectRefresh = true;
  let rejected = 0;
  const patches: unknown[] = [];
  github.use(
    githubGraphql.query("Repository", () => {
      if (saved && rejectRefresh) {
        rejected++;
        return HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 });
      }
      return HttpResponse.json({
        data: { repository: { ...adminRepo, homepageUrl: saved ? homepage : null } },
      });
    }),
    http.patch(`${API_ORIGIN}/repos${REPO}`, async ({ request }) => {
      patches.push(await request.json());
      saved = true;
      return HttpResponse.json({
        description: adminRepo.description,
        homepage,
        has_issues: true,
        has_wiki: false,
        has_projects: true,
      });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, settingsPath);
  const screen = inScreen(page, settingsPath);
  const website = screen.getByLabel(enRepo["admin.homepage"]);
  await website.fill("https://example.test");
  const save = screen.getByRole("button", { name: enRepo["admin.save"], exact: true });
  await save.click();
  const error = screen.getByRole("alert");
  await expect(error).toContainText(enErrors["forbidden.title"]);
  expect(rejected).toBeGreaterThan(0);
  await expect(website).toHaveValue(homepage);
  await expect(save).toBeDisabled();
  rejectRefresh = false;
  await error.getByRole("button", { name: "Retry" }).click();
  await expect(error).toBeHidden();
  await expect(website).toHaveValue(homepage);
  expect(patches).toEqual([{ homepage: "https://example.test" }]);
});
