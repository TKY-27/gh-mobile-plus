import { HttpResponse } from "msw";
import assignableUsers from "../src/data/issues/fixtures/assignable-users.json" with { type: "json" };
import mergeFixture from "../src/data/pulls/fixtures/merge.json" with { type: "json" };
import mergeStates from "../src/data/pulls/fixtures/merge-states.json" with { type: "json" };
import pullFixture from "../src/data/pulls/fixtures/pull-request.json" with { type: "json" };
import enErrors from "../src/i18n/messages/en/errors.json" with { type: "json" };
import enPull from "../src/i18n/messages/en/pull.json" with { type: "json" };
import { tapInSheet } from "./support/accounts.ts";
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

const PULL_PATH = "/octo-org/hello-mobile/pull/43";
const PULL = pullFixture.data.repository.issueOrPullRequest;

function pullWith(fields: Record<string, unknown>) {
  return {
    data: {
      repository: {
        ...pullFixture.data.repository,
        issueOrPullRequest: { ...PULL, ...fields },
      },
    },
  };
}

async function openMergeSheet(page: import("@playwright/test").Page) {
  await openInApp(page, PULL_PATH);
  const screen = page.locator(`[data-stack-screen="${PULL_PATH}"]`);
  await screen.getByRole("button", { name: enPull["merge.open"] }).click();
  return page.getByRole("dialog", { name: enPull["merge.title"] });
}

test("offers only allowed methods and explains why merging is blocked", async ({
  page,
  oauth,
  github,
}) => {
  github.use(githubGraphql.query("Conversation", () => HttpResponse.json(pullFixture)));
  await signIn(page, oauth);
  const sheet = await openMergeSheet(page);

  const reasons = sheet.getByRole("list", { name: enPull["mergeStatus.reasons"] });
  await expect(reasons.getByRole("listitem")).toHaveText([
    enPull["blocked.changesRequested"],
    enPull["blocked.checksFailing"],
  ]);
  await expect(sheet.getByRole("button", { name: enPull["merge.method.squash"] })).toBeDisabled();

  await tapInSheet(sheet.getByRole("button", { name: enPull["merge.chooseMethod"] }));
  await expect(page.getByRole("menuitem")).toHaveText([
    enPull["merge.method.merge"],
    enPull["merge.method.squash"],
  ]);
});

test("squash merges and deletes the head branch", async ({ page, oauth, github }) => {
  const merges: unknown[] = [];
  const deletions: unknown[] = [];
  github.use(
    githubGraphql.query("Conversation", () =>
      HttpResponse.json(pullWith(mergeStates.clean.fields)),
    ),
    githubGraphql.mutation("MergePullRequest", ({ variables }) => {
      merges.push(variables);
      return HttpResponse.json(mergeFixture);
    }),
    githubGraphql.mutation("DeleteRef", ({ variables }) => {
      deletions.push(variables);
      return HttpResponse.json({ data: { deleteRef: { clientMutationId: null } } });
    }),
  );
  await signIn(page, oauth);
  const sheet = await openMergeSheet(page);

  await expect(sheet.getByText(enPull["mergeStatus.ready"])).toBeVisible();
  await tapInSheet(sheet.getByRole("button", { name: enPull["merge.chooseMethod"] }));
  await tapInSheet(page.getByRole("menuitem", { name: enPull["merge.method.squash"] }));
  await expect(sheet.getByRole("textbox", { name: enPull["merge.commitTitle"] })).toHaveValue(
    PULL.squashHeadline,
  );
  const deleteBranch = enPull["merge.deleteBranch"].replace("{branch}", PULL.headRefName);
  // The switch input is visually hidden.
  await tapInSheet(sheet.getByText(deleteBranch));
  await expect(sheet.getByRole("switch", { name: deleteBranch })).toBeChecked();
  await sheet.getByRole("button", { name: enPull["merge.method.squash"] }).click();

  await expect(page.getByText(enPull["merge.mergedDeleted"])).toBeVisible();
  expect(merges).toEqual([
    {
      id: PULL.id,
      method: "SQUASH",
      expectedHeadOid: PULL.headRefOid,
      headline: PULL.squashHeadline,
      body: PULL.squashBody,
    },
  ]);
  expect(deletions).toEqual([{ id: mergeFixture.data.mergePullRequest.pullRequest.headRef.id }]);
});

test("offers SSO inside the sheet when merging is restricted", async ({ page, oauth, github }) => {
  const ssoUrl = "https://github.com/orgs/octo-org/sso";
  github.use(
    githubGraphql.query("Conversation", () =>
      HttpResponse.json(pullWith(mergeStates.clean.fields)),
    ),
    githubGraphql.mutation("MergePullRequest", () =>
      HttpResponse.json(
        {
          data: { mergePullRequest: null },
          errors: [{ message: "Organization SAML enforcement" }],
        },
        { headers: { "X-GitHub-SSO": `required; url=${ssoUrl}` } },
      ),
    ),
  );
  await signIn(page, oauth);
  const sheet = await openMergeSheet(page);
  await tapInSheet(sheet.getByRole("button", { name: enPull["merge.method.squash"] }));

  await expect(sheet.getByRole("alert")).toContainText(enErrors["orgAccessRestricted.message"]);
  await expect(
    sheet.getByRole("link", { name: enErrors["orgAccessRestricted.sso"] }),
  ).toHaveAttribute("href", ssoUrl);
});

test("offers SSO after a merge succeeds but branch deletion is restricted", async ({
  page,
  oauth,
  github,
}) => {
  let merges = 0;
  const ssoUrl = "https://github.com/orgs/octo-org/sso";
  const restrictedDeleteRef = {
    data: { deleteRef: null },
    errors: [
      {
        type: "FORBIDDEN",
        message:
          "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
      },
    ],
  };
  github.use(
    githubGraphql.query("Conversation", () =>
      HttpResponse.json(pullWith(mergeStates.clean.fields)),
    ),
    githubGraphql.mutation("MergePullRequest", () => {
      merges++;
      return HttpResponse.json(mergeFixture);
    }),
    githubGraphql.mutation("DeleteRef", () =>
      HttpResponse.json(restrictedDeleteRef, {
        headers: { "X-GitHub-SSO": `required; url=${ssoUrl}` },
      }),
    ),
  );
  await signIn(page, oauth);
  const sheet = await openMergeSheet(page);
  await tapInSheet(
    sheet.getByText(enPull["merge.deleteBranch"].replace("{branch}", PULL.headRefName)),
  );
  await tapInSheet(sheet.getByRole("button", { name: enPull["merge.method.squash"] }));
  const notifications = page.getByRole("region", { name: "Notifications" });
  const toast = notifications.getByRole("status");
  await expect(toast).toContainText(enPull["merge.mergedKeptBranch"]);
  await expect(toast).toContainText(enErrors["orgAccessRestricted.message"]);
  await expect(
    toast.getByRole("button", { name: enErrors["orgAccessRestricted.sso"] }),
  ).toBeVisible();
  expect(merges).toBe(1);
});

test("keeps requested reviewers and adds new ones", async ({ page, oauth, github }) => {
  const requests: unknown[] = [];
  github.use(
    githubGraphql.query("AssignableUsers", () => HttpResponse.json(assignableUsers)),
    githubGraphql.mutation("RequestReviews", ({ variables }) => {
      requests.push(variables);
      return HttpResponse.json({ data: { requestReviews: { clientMutationId: null } } });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, PULL_PATH);
  const screen = page.locator(`[data-stack-screen="${PULL_PATH}"]`);
  await screen.getByRole("button", { name: enPull["reviewers.request"] }).click();
  const sheet = page.getByRole("dialog", { name: enPull["reviewers.request"] });

  await expect(sheet.getByText(enPull["reviewers.requestedNote"])).toBeVisible();
  const requested = sheet.getByRole("option", { name: "octocat" });
  await expect(requested).toHaveAttribute("aria-selected", "true");
  await expect(requested).toHaveAttribute("aria-disabled", "true");
  await tapInSheet(sheet.getByRole("option", { name: "hubot" }));
  await tapInSheet(sheet.getByRole("button", { name: "Done" }));

  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText(enPull["reviewers.requested"]),
  ).toBeVisible();
  const ids = new Map(
    assignableUsers.data.repository.assignableUsers.nodes.map((user) => [user.login, user.id]),
  );
  expect(requests).toEqual([{ id: PULL.id, userIds: [ids.get("octocat"), ids.get("hubot")] }]);
});
