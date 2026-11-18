import organizations from "../src/data/users/fixtures/organizations.json" with { type: "json" };
import profile from "../src/data/users/fixtures/profile.json" with { type: "json" };
import environments from "../src/data/actions/fixtures/environments.json" with { type: "json" };
import jobs from "../src/data/actions/fixtures/jobs.json" with { type: "json" };
import run from "../src/data/actions/fixtures/run.json" with { type: "json" };
import runs from "../src/data/actions/fixtures/runs.json" with { type: "json" };
import workflows from "../src/data/actions/fixtures/workflows.json" with { type: "json" };
import refs from "../src/data/repo/fixtures/refs.json" with { type: "json" };
import repository from "../src/data/repo/fixtures/repository.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import enActions from "../src/i18n/messages/en/actions.json" with { type: "json" };
import enCommon from "../src/i18n/messages/en/common.json" with { type: "json" };
import enErrors from "../src/i18n/messages/en/errors.json" with { type: "json" };
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";
import { tapInSheet, waitForSheetControl } from "./support/accounts.ts";
import { openInApp } from "./support/screens.ts";

const HTTP_NOT_FOUND = 404;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const REPO = "/octo-org/hello-mobile";
const RUN_PATH = `${REPO}/actions/runs/${String(run.id)}`;
const DEPLOY_WORKFLOW_ID = 161336;
const COMPLETED_JOB_ID = 31415926501;
// Retries back off before the fallback.
const FALLBACK_TIMEOUT_MS = 20_000;
const jobLog = readFileSync(
  new URL("../src/data/actions/fixtures/job-log.txt", import.meta.url),
  "utf8",
);
const deployWorkflow = readFileSync(
  new URL("../src/data/actions/fixtures/deploy.yml", import.meta.url),
  "utf8",
);

const failedRun = { ...run, status: "completed", conclusion: "failure" };
const failedJobs = {
  ...jobs,
  jobs: jobs.jobs.map((job) =>
    job.status === "completed"
      ? job
      : {
          ...job,
          status: "completed",
          conclusion: "failure",
          completed_at: "2026-11-17T10:04:00Z",
          steps: job.steps.map((step) => ({
            ...step,
            status: "completed",
            conclusion: "failure",
            started_at: "2026-11-17T10:00:00Z",
            completed_at: "2026-11-17T10:04:00Z",
          })),
        },
  ),
};

test.beforeEach(({ github }) => {
  github.use(
    githubGraphql.query("ViewerOrganizations", () => HttpResponse.json(organizations)),
    githubGraphql.query("Profile", () => HttpResponse.json(profile)),
    githubGraphql.query("Repository", () => HttpResponse.json(repository)),
    githubGraphql.query("RepositoryRefs", () => HttpResponse.json(refs)),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/readme`, () =>
      HttpResponse.json({ message: "Not Found" }, { status: HTTP_NOT_FOUND }),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/workflows`, () =>
      HttpResponse.json(workflows),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/runs`, () => HttpResponse.json(runs)),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/runs/:id`, () =>
      HttpResponse.json(failedRun),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/runs/:id/jobs`, () =>
      HttpResponse.json(failedJobs),
    ),
  );
});

test("the runs list shows status and filters by workflow and status", async ({
  page,
  oauth,
  github,
}) => {
  const filteredQueries: string[] = [];
  github.use(
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/workflows/:id/runs`, ({ request }) => {
      filteredQueries.push(request.url);
      return HttpResponse.json({ total_count: 1, workflow_runs: [runs.workflow_runs[2]] });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/actions`);

  const list = page.getByRole("list", { name: enActions["runs.title"] });
  await expect(list.getByText("Translate the greeting")).toBeVisible();
  await expect(list.getByText(enActions["status.failure"])).toBeVisible();
  await expect(
    list.getByText(enActions["event.pullRequest"], { exact: false }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: enActions["filters.open"] }).click();
  const sheet = page.getByRole("dialog", { name: enActions["filters.title"] });
  await tapInSheet(sheet.getByText("Deploy", { exact: true }));
  await expect(sheet.getByRole("radio", { name: "Deploy", exact: true })).toBeChecked();
  await tapInSheet(sheet.getByText(enActions["status.success"], { exact: true }));
  await expect(
    sheet
      .getByRole("radiogroup", { name: enActions["filters.status"] })
      .getByRole("radio", { checked: true }),
  ).toHaveAccessibleName(enActions["status.success"]);
  await page.keyboard.press("Escape");

  await expect(list.getByText("Translate the greeting")).toHaveCount(0);
  await expect(list.getByText("Deploy", { exact: true })).toBeVisible();
  const last = new URL(filteredQueries.at(-1) ?? "https://invalid");
  expect(last.pathname).toContain(`/actions/workflows/${String(DEPLOY_WORKFLOW_ID)}/runs`);
  expect(last.searchParams.get("status")).toBe("success");
  await expect(
    page.getByRole("button", {
      name: enActions["filters.openActive.other"].replace("{count}", "2"),
    }),
  ).toBeVisible();
});

test("run detail re-runs only the failed jobs", async ({ page, oauth, github }) => {
  const reruns: string[] = [];
  github.use(
    http.post(`${API_ORIGIN}/repos/:owner/:repo/actions/runs/:id/:action`, ({ request }) => {
      reruns.push(new URL(request.url).pathname);
      return new HttpResponse(null, { status: HTTP_CREATED });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, RUN_PATH);

  await expect(page.getByRole("heading", { name: "Translate the greeting" })).toBeVisible();
  await expect(page.getByText("Run pnpm test")).toBeVisible();
  await page.getByRole("button", { name: enActions["run.rerunFailedJobs"] }).click();

  await expect(
    page.getByRole("status").filter({ hasText: enActions["run.rerunStarted"] }),
  ).toBeVisible();
  expect(reruns).toEqual([`${RUN_PATH.replace("/octo-org", "/repos/octo-org")}/rerun-failed-jobs`]);
});

test("the log viewer folds groups and searches with next and previous", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/jobs/:id/logs`, () =>
      HttpResponse.text(jobLog),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${RUN_PATH}/job/${String(COMPLETED_JOB_ID)}`);

  const group = page.getByRole("button", { name: /Run actions\/checkout@v5/ });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("repository: octo-org/hello-mobile")).toHaveCount(0);
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("repository: octo-org/hello-mobile")).toBeVisible();
  await group.click();
  await expect(page.getByText("repository: octo-org/hello-mobile")).toHaveCount(0);

  await page.getByPlaceholder(enActions["log.search"]).fill("test");
  const position = (current: number, total: number) =>
    enActions["log.matchPosition"]
      .replace("{current}", String(current))
      .replace("{total}", String(total));
  await expect(page.getByText(position(1, 4))).toBeVisible();
  await page.getByRole("button", { name: enActions["log.next"] }).click();
  await expect(page.getByText(position(2, 4))).toBeVisible();
  await page.getByRole("button", { name: enActions["log.previous"] }).click();
  await page.getByRole("button", { name: enActions["log.previous"] }).click();
  await expect(page.getByText(position(4, 4))).toBeVisible();
  await expect(page.locator("mark").first()).toBeVisible();

  await page.getByPlaceholder(enActions["log.search"]).fill("repository:");
  await page.getByRole("button", { name: enActions["log.next"] }).click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("mark", { hasText: "repository:" })).toBeVisible();
});

test("an unreadable log redirect falls back to Open on GitHub", async ({ page, oauth, github }) => {
  github.use(
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/jobs/:id/logs`, () => HttpResponse.error()),
  );
  await signIn(page, oauth);
  await openInApp(page, `${RUN_PATH}/job/${String(COMPLETED_JOB_ID)}`);

  await expect(page.getByText(enActions["log.unreadableTitle"])).toBeVisible({
    timeout: FALLBACK_TIMEOUT_MS,
  });
  await expect(page.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/octo-org\/hello-mobile\/actions\/runs\/\d+\/job\/31415926501$/,
  );
});

test("dispatches a filtered ref beyond the initial limit with typed inputs", async ({
  page,
  oauth,
  github,
}) => {
  const dispatches: unknown[] = [];
  const searchedRefs: unknown[] = [];
  const inputRefs: (string | null)[] = [];
  const releaseRef = "release/mobile";
  const branchRef = `refs/heads/${releaseRef}`;
  const tagRef = `refs/tags/${releaseRef}`;
  const refFixture = refs.data.repository;
  github.use(
    githubGraphql.query("RepositoryRefs", ({ variables }) => {
      searchedRefs.push(variables.query);
      const matches = variables.query === "mobile";
      return HttpResponse.json({
        data: {
          repository: {
            ...refFixture,
            branches: {
              nodes: [{ name: matches ? releaseRef : "main" }],
              pageInfo: {
                hasNextPage: !matches,
                endCursor: matches ? null : `${String(variables.branchesAfter ?? "")}-next`,
              },
            },
            tags: { ...refFixture.tags, nodes: matches ? [{ name: releaseRef }] : [] },
          },
        },
      });
    }),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/contents/.github/workflows/:file`, ({ request }) => {
      inputRefs.push(new URL(request.url).searchParams.get("ref"));
      return HttpResponse.text(deployWorkflow);
    }),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/environments`, () =>
      HttpResponse.json(environments),
    ),
    http.post(
      `${API_ORIGIN}/repos/:owner/:repo/actions/workflows/:id/dispatches`,
      async ({ request, params }) => {
        dispatches.push({ workflow: params.id, body: await request.json() });
        return new HttpResponse(null, { status: HTTP_NO_CONTENT });
      },
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/actions`);
  await page.getByRole("button", { name: enActions["dispatch.open"] }).click();

  const sheet = page.getByRole("dialog", { name: enActions["dispatch.title"] });
  const workflow = sheet.getByLabel(enActions["dispatch.workflow"], { exact: true });
  await waitForSheetControl(workflow);
  await workflow.selectOption("Deploy");
  await sheet.getByRole("searchbox", { name: enActions["dispatch.filterRefs"] }).fill("mobile");
  const refPicker = sheet.getByLabel(enActions["dispatch.ref"], { exact: true });
  await expect(refPicker.locator(`option[value="${branchRef}"]`)).toHaveText(releaseRef);
  await refPicker.selectOption(tagRef);
  expect(searchedRefs).toContain("mobile");
  const version = sheet.getByRole("textbox", { name: /version/ });
  await version.fill("");
  await sheet.getByRole("button", { name: enActions["dispatch.submit"] }).click();
  await expect(sheet.getByText(enActions["dispatch.required"])).toBeVisible();
  expect(dispatches).toEqual([]);

  await version.fill("v2.0.0");
  await sheet.getByText("dry_run", { exact: true }).click();
  await expect(sheet.getByRole("switch", { name: "dry_run" })).not.toBeChecked();
  await sheet.getByRole("textbox", { name: "replicas" }).fill("5");
  await sheet.getByLabel(/region/).selectOption("us-east-1");
  await sheet.getByRole("button", { name: enActions["dispatch.submit"] }).click();

  await expect(sheet).toHaveCount(0);
  expect(inputRefs).toContain(tagRef);
  expect(dispatches).toEqual([
    {
      workflow: String(DEPLOY_WORKFLOW_ID),
      body: {
        ref: tagRef,
        inputs: {
          version: "v2.0.0",
          dry_run: "false",
          replicas: "5",
          region: "us-east-1",
          target: "staging",
        },
      },
    },
  ]);
});

test("shows the org approval link inside a rejected dispatch sheet", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    http.get(`${API_ORIGIN}/repos/:owner/:repo/contents/.github/workflows/:file`, () =>
      HttpResponse.text(deployWorkflow),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/environments`, () =>
      HttpResponse.json(environments),
    ),
    http.post(`${API_ORIGIN}/repos/:owner/:repo/actions/workflows/:id/dispatches`, () =>
      HttpResponse.json(
        { message: "OAuth App access restrictions for the `octo-org` organization" },
        { status: HTTP_FORBIDDEN },
      ),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/actions`);
  await page.getByRole("button", { name: enActions["dispatch.open"] }).click();
  const sheet = page.getByRole("dialog", { name: enActions["dispatch.title"] });
  const workflow = sheet.getByLabel(enActions["dispatch.workflow"], { exact: true });
  await waitForSheetControl(workflow);
  await workflow.selectOption("Deploy");
  await sheet.getByRole("textbox", { name: /version/ }).fill("v2.0.0");
  await sheet.getByRole("button", { name: enActions["dispatch.submit"] }).click();

  await expect(sheet.getByRole("alert")).toContainText(enErrors["orgAccessRestricted.message"]);
  await expect(
    sheet.getByRole("link", { name: enErrors["orgAccessRestricted.request"] }),
  ).toHaveAttribute("href", /^https:\/\/github\.com\/settings\/connections\/applications\/[^/]+$/);
});

test("shows an empty Run sheet when the repository has no workflows", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    githubGraphql.query("Repository", () =>
      HttpResponse.json({
        data: {
          repository: { ...repository.data.repository, defaultBranchRef: null },
        },
      }),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/workflows`, () =>
      HttpResponse.json({ total_count: 0, workflows: [] }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/actions`);
  await page.getByRole("button", { name: enActions["dispatch.open"] }).click();
  const sheet = page.getByRole("dialog", { name: enActions["dispatch.title"] });
  await expect(sheet.getByText(enActions["dispatch.noWorkflows"])).toBeVisible();
});

test("a failed environments request shows Retry instead of an empty picker", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    http.get(`${API_ORIGIN}/repos/:owner/:repo/contents/.github/workflows/:file`, () =>
      HttpResponse.text(deployWorkflow),
    ),
    http.get(`${API_ORIGIN}/repos/:owner/:repo/environments`, () =>
      HttpResponse.json({ message: "Resource not accessible" }, { status: HTTP_FORBIDDEN }),
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, `${REPO}/actions`);
  await page.getByRole("button", { name: enActions["dispatch.open"] }).click();
  const sheet = page.getByRole("dialog", { name: enActions["dispatch.title"] });
  const workflow = sheet.getByLabel(enActions["dispatch.workflow"], { exact: true });
  await waitForSheetControl(workflow);
  await workflow.selectOption("Deploy");

  await expect(sheet.getByRole("alert")).toContainText(enErrors["forbidden.title"]);
  await expect(sheet.getByRole("button", { name: enCommon.retry })).toBeVisible();
  await expect(sheet.getByRole("button", { name: enActions["dispatch.submit"] })).toHaveCount(0);
});
