import { http, HttpResponse } from "msw";
import assignableUsers from "../src/data/issues/fixtures/assignable-users.json" with { type: "json" };
import issueFixture from "../src/data/issues/fixtures/issue.json" with { type: "json" };
import labelsFixture from "../src/data/issues/fixtures/labels.json" with { type: "json" };
import enErrors from "../src/i18n/messages/en/errors.json" with { type: "json" };
import enIssue from "../src/i18n/messages/en/issue.json" with { type: "json" };
import { tapInSheet } from "./support/accounts.ts";
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";
import { openInApp, REPO } from "./support/screens.ts";

const ISSUE_PATH = "/octo-org/hello-mobile/issues/42";
const ISSUE_ID = "I_kwDOJx1cRc6Ab12C";
const ALL_LABELS = labelsFixture.data.repository.labels.nodes;
const NEW_ISSUE_PATH = `${REPO}/issues/new`;
const HTTP_FORBIDDEN = 403;

interface IssueServer {
  labels: string[];
  closedAs: "NOT_PLANNED" | null;
  added: unknown[];
  removed: unknown[];
  closed: unknown[];
  comments: unknown[];
}

function conversation(server: IssueServer) {
  const subject = issueFixture.data.repository.issueOrPullRequest;
  const labels = ALL_LABELS.filter((label) => server.labels.includes(label.id)).map(
    ({ name, color, description }) => ({ name, color, description }),
  );
  return {
    data: {
      repository: {
        ...issueFixture.data.repository,
        issueOrPullRequest: {
          ...subject,
          labels: { nodes: labels },
          ...(server.closedAs ? { issueState: "CLOSED", stateReason: server.closedAs } : {}),
        },
      },
    },
  };
}

function issueServer(): IssueServer {
  const initial = new Set(["bug", "offline"]);
  return {
    labels: ALL_LABELS.filter((label) => initial.has(label.name)).map((label) => label.id),
    closedAs: null,
    added: [],
    removed: [],
    closed: [],
    comments: [],
  };
}

function handlersFor(server: IssueServer) {
  return [
    githubGraphql.query("Conversation", () => HttpResponse.json(conversation(server))),
    githubGraphql.query("RepositoryLabels", () => HttpResponse.json(labelsFixture)),
    githubGraphql.query("AssignableUsers", () => HttpResponse.json(assignableUsers)),
    githubGraphql.query("SubjectAssignment", () =>
      HttpResponse.json({
        data: {
          node: {
            __typename: "Issue",
            labels: {
              nodes: ALL_LABELS.filter((label) => server.labels.includes(label.id)).map(
                ({ id, name }) => ({ id, name }),
              ),
            },
            assignees: { nodes: [{ id: "U_kgDOAAAAAQ", login: "mona" }] },
          },
        },
      }),
    ),
    githubGraphql.mutation<Record<string, unknown>, { id: string; labelIds: string[] }>(
      "AddLabels",
      ({ variables }) => {
        server.added.push(variables);
        server.labels.push(...variables.labelIds);
        return HttpResponse.json({ data: { addLabelsToLabelable: { clientMutationId: null } } });
      },
    ),
    githubGraphql.mutation<Record<string, unknown>, { id: string; labelIds: string[] }>(
      "RemoveLabels",
      ({ variables }) => {
        server.removed.push(variables);
        server.labels = server.labels.filter((id) => !variables.labelIds.includes(id));
        return HttpResponse.json({
          data: { removeLabelsFromLabelable: { clientMutationId: null } },
        });
      },
    ),
    githubGraphql.mutation("CloseIssue", ({ variables }) => {
      server.closed.push(variables);
      server.closedAs = "NOT_PLANNED";
      return HttpResponse.json({ data: { closeIssue: { clientMutationId: null } } });
    }),
    githubGraphql.mutation("AddComment", ({ variables }) => {
      server.comments.push(variables);
      return HttpResponse.json({ data: { addComment: { clientMutationId: null } } });
    }),
  ];
}

async function openIssue(page: import("@playwright/test").Page) {
  await openInApp(page, ISSUE_PATH);
  const screen = page.locator(`[data-stack-screen="${ISSUE_PATH}"]`);
  await expect(screen.getByRole("heading", { level: 1 })).toHaveText(
    "Crash when opening notifications offline",
  );
  return screen;
}

test("submits an untouched required template default", async ({ page, oauth, github }) => {
  const submitted: string[] = [];
  const template = `name: Device report
title: Device issue
body:
  - type: input
    id: platform
    attributes:
      label: Platform
      value: macOS
    validations:
      required: true
  - type: dropdown
    id: version
    attributes:
      label: Version
      options: [Stable, Beta]
      default: 1
    validations:
      required: true
`;
  github.use(
    ...handlersFor(issueServer()),
    githubGraphql.query("IssueTemplates", () =>
      HttpResponse.json({
        data: {
          repository: {
            object: {
              __typename: "Tree",
              entries: [
                {
                  type: "blob",
                  name: "device.yml",
                  object: { __typename: "Blob", text: template },
                },
              ],
            },
          },
        },
      }),
    ),
    githubGraphql.mutation<Record<string, unknown>, { body: string }>(
      "CreateIssue",
      ({ variables }) => {
        submitted.push(variables.body);
        return HttpResponse.json({ data: { createIssue: { issue: { number: 42 } } } });
      },
    ),
  );
  await signIn(page, oauth);
  await openInApp(page, NEW_ISSUE_PATH);
  await page.getByRole("button", { name: "Device report" }).click();
  await expect(page.getByRole("textbox", { name: "Platform" })).toHaveValue("macOS");
  await expect(page.getByLabel("Version", { exact: true })).toHaveValue("Beta");
  await page.getByRole("button", { name: enIssue["new.submit"] }).click();
  await expect(page).toHaveURL(ISSUE_PATH);
  expect(submitted).toEqual(["### Platform\n\nmacOS\n\n### Version\n\nBeta"]);
  await openInApp(page, NEW_ISSUE_PATH);
  await expect(page.getByRole("button", { name: "Device report" })).toBeVisible();
});

test("preserves edits made while creating an issue", async ({ page, oauth, github }) => {
  const submitted: unknown[] = [];
  let finishCreation = () => {};
  const creation = new Promise<void>((resolve) => {
    finishCreation = resolve;
  });
  github.use(
    ...handlersFor(issueServer()),
    githubGraphql.query("IssueTemplates", () =>
      HttpResponse.json({ data: { repository: { object: null } } }),
    ),
    githubGraphql.mutation("CreateIssue", async ({ variables }) => {
      submitted.push(variables);
      await creation;
      return HttpResponse.json({ data: { createIssue: { issue: { number: 42 } } } });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, NEW_ISSUE_PATH);
  await page.getByRole("textbox", { name: enIssue["new.title"] }).fill("First title");
  const body = page.getByRole("textbox", { name: enIssue["new.body"] });
  await body.fill("First body");
  await page.getByRole("button", { name: enIssue["new.submit"] }).click();
  try {
    await expect
      .poll(() => submitted)
      .toEqual([expect.objectContaining({ title: "First title", body: "First body" })]);
    await body.fill("Follow-up details");
  } finally {
    finishCreation();
  }
  await expect(page).toHaveURL(ISSUE_PATH);

  await openInApp(page, NEW_ISSUE_PATH);
  await expect(body).toHaveValue("Follow-up details");
});

test("shows the SSO link inside a restricted Markdown preview", async ({ page, oauth, github }) => {
  const ssoUrl = "https://github.com/orgs/octo-org/sso";
  github.use(
    ...handlersFor(issueServer()),
    http.post(`${API_ORIGIN}/markdown`, () =>
      HttpResponse.json(
        { message: "Resource protected by organization SAML enforcement" },
        { status: HTTP_FORBIDDEN, headers: { "X-GitHub-SSO": `required; url=${ssoUrl}` } },
      ),
    ),
  );
  await signIn(page, oauth);
  const screen = await openIssue(page);
  await screen.getByRole("textbox", { name: enIssue["comment.field"] }).fill("Preview this");
  await screen.getByRole("tab", { name: enIssue["composer.preview"] }).click();
  const preview = screen.getByRole("tabpanel");
  await expect(preview.getByRole("alert")).toContainText(enErrors["orgAccessRestricted.message"]);
  await expect(
    preview.getByRole("link", { name: enErrors["orgAccessRestricted.sso"] }),
  ).toHaveAttribute("href", ssoUrl);
});

test("comments after previewing the rendered Markdown", async ({ page, oauth, github }) => {
  const server = issueServer();
  github.use(
    ...handlersFor(server),
    http.post(`${API_ORIGIN}/markdown`, () =>
      HttpResponse.text("<p>Fixed by <strong>#43</strong></p>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  await signIn(page, oauth);
  const screen = await openIssue(page);

  const field = screen.getByRole("textbox", { name: enIssue["comment.field"] });
  await field.fill("Fixed by **#43**");
  await screen.getByRole("tab", { name: enIssue["composer.preview"] }).click();
  await expect(screen.getByRole("tabpanel").getByText("#43")).toBeVisible();
  await screen.getByRole("tab", { name: enIssue["composer.write"] }).click();
  await screen.getByRole("button", { name: enIssue["comment.submit"], exact: true }).click();

  await expect(page.getByText(enIssue["comment.posted"])).toBeVisible();
  expect(server.comments).toEqual([{ subjectId: ISSUE_ID, body: "Fixed by **#43**" }]);
  await expect(field).toHaveValue("");
});

test("adds a label, then undoes it from the toast", async ({ page, oauth, github }) => {
  const server = issueServer();
  github.use(...handlersFor(server));
  await signIn(page, oauth);
  const screen = await openIssue(page);
  const enhancement = ALL_LABELS.find((label) => label.name === "enhancement");
  if (!enhancement) throw new Error("fixture lacks the enhancement label");

  await screen.getByRole("button", { name: new RegExp(`^${enIssue["labels.title"]}`) }).click();
  const sheet = page.getByRole("dialog", { name: enIssue["labels.title"] });
  await tapInSheet(sheet.getByRole("option", { name: /enhancement/ }));
  await tapInSheet(sheet.getByRole("button", { name: enIssue["picker.done"] }));

  const added = enIssue["labels.added"].replace("{label}", "enhancement");
  await expect(page.getByText(added)).toBeVisible();
  await expect(screen.getByText("enhancement", { exact: true }).first()).toBeVisible();
  await expect.poll(() => server.added).toEqual([{ id: ISSUE_ID, labelIds: [enhancement.id] }]);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => server.removed).toEqual([{ id: ISSUE_ID, labelIds: [enhancement.id] }]);
  await expect(screen.getByText("enhancement", { exact: true })).toHaveCount(0);
});

test("closes the issue as not planned", async ({ page, oauth, github }) => {
  const server = issueServer();
  github.use(...handlersFor(server));
  await signIn(page, oauth);
  const screen = await openIssue(page);

  await screen.getByRole("button", { name: "More actions" }).click();
  await tapInSheet(page.getByRole("menuitem", { name: enIssue["actions.closeNotPlanned"] }));

  await expect(page.getByText(enIssue["actions.closedNotPlanned"])).toBeVisible();
  await expect(screen.getByText(enIssue["state.notPlanned"], { exact: true })).toBeVisible();
  await expect.poll(() => server.closed).toEqual([{ id: ISSUE_ID, stateReason: "NOT_PLANNED" }]);
});
