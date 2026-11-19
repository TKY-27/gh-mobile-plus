import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { rememberOAuthClientId } from "@/data/errors";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { CommitSheet } from "./CommitSheet.tsx";

vi.mock("@/data/session", () => ({
  useActiveAccount: () => ({ id: 320, login: "mona", avatarUrl: "", publicOnly: false }),
}));

const github = graphql.link("https://api.github.com/graphql");
const server = setupServer(
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_commit_fixture", expiresAt: null }),
  ),
);
const ssoUrl = "https://github.com/orgs/octo-org/sso";

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});

beforeEach(() => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: (_name: string, callback: LockGrantedCallback<unknown>) => callback(null) },
  });
  class LayoutObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", LayoutObserver);
  vi.stubGlobal("IntersectionObserver", LayoutObserver);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  rememberOAuthClientId("test-client");
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  rememberOAuthClientId(null);
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllGlobals();
});

afterAll(() => {
  server.close();
});

it.each([
  {
    url: ssoUrl,
    label: "Authorize single sign-on",
    destination: ssoUrl,
  },
  {
    url: undefined,
    label: "Request organization approval",
    destination: "https://github.com/settings/connections/applications/test-client",
  },
])(
  "offers $label inside the commit sheet after a restriction",
  async ({ url, label, destination }) => {
    server.use(
      github.mutation("CommitFileEdit", () =>
        HttpResponse.json(
          {
            errors: [
              { message: "OAuth App access restrictions are enabled for this organization." },
            ],
          },
          { status: 403, headers: url ? { "x-github-sso": `required; url=${url}` } : {} },
        ),
      ),
    );
    const onCommitted = vi.fn();
    await act(async () => {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Suspense fallback={null}>
            <I18nProvider language="en">
              <CommitSheet
                isOpen
                onOpenChange={vi.fn()}
                subject={{
                  owner: "octo-org",
                  repo: "hello-mobile",
                  branch: "main",
                  path: "src/hello.ts",
                  content: "export const hello = false;",
                  baseOid: "0123456789abcdef0123456789abcdef01234567",
                }}
                canPush
                canProposePull
                login="mona"
                onCommitted={onCommitted}
              />
            </I18nProvider>
          </Suspense>
        </QueryClientProvider>,
      );
      await loadMessages("en");
    });

    const sheet = within(await screen.findByRole("dialog", { name: "Commit changes" }));
    fireEvent.click(sheet.getByRole("radio", { name: /directly/i }));
    fireEvent.click(sheet.getByRole("button", { name: "Commit changes" }));
    const notice = within(await sheet.findByRole("alert"));
    expect(notice.getByText(/This organization needs to approve GH Mobile\+/)).toBeTruthy();
    expect(notice.getByRole("link", { name: label }).getAttribute("href")).toBe(destination);
    expect(onCommitted).not.toHaveBeenCalled();
  },
);

async function renderCreateSheet(options: {
  path?: string;
  canProposePull?: boolean;
  onChangePath?: () => void;
  onCommitted?: () => void;
}) {
  const onCommitted = options.onCommitted ?? vi.fn();
  const onChangePath = options.onChangePath ?? vi.fn();
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <I18nProvider language="en">
            <CommitSheet
              mode="create"
              isOpen
              onOpenChange={vi.fn()}
              subject={{
                owner: "octo-org",
                repo: "hello-mobile",
                branch: "main",
                path: options.path ?? "src/alpha.ts",
                content: "export const created = true;\n",
                baseOid: "0123456789abcdef0123456789abcdef01234567",
              }}
              canPush
              canProposePull={options.canProposePull ?? true}
              login="mona"
              onChangePath={onChangePath}
              onCommitted={onCommitted}
            />
          </I18nProvider>
        </Suspense>
      </QueryClientProvider>,
    );
    await loadMessages("en");
  });
  return {
    sheet: within(await screen.findByRole("dialog", { name: "Commit new file" })),
    onCommitted,
    onChangePath,
  };
}

function createCheckResult(options: { fileExists?: boolean; isArchived?: boolean } = {}) {
  return {
    data: {
      repository: {
        isPrivate: false,
        isArchived: options.isArchived ?? false,
        isDisabled: false,
        isLocked: false,
        forkingAllowed: true,
        hasPullRequestsEnabled: true,
        viewerPermission: "WRITE",
        ref: {
          prefix: "refs/heads/",
          target: {
            __typename: "Commit",
            oid: "0123456789abcdef0123456789abcdef01234567",
            file: options.fileExists ? { type: "blob" } : null,
            parent: { type: "tree" },
          },
        },
      },
    },
  };
}

it("blocks overwriting an existing file and lets the user change the file name", async () => {
  let writes = 0;
  server.use(
    github.query("CheckNewFilePath", () =>
      HttpResponse.json(createCheckResult({ fileExists: true })),
    ),
    github.mutation("CommitFileEdit", () => {
      writes++;
      return HttpResponse.json({ data: { createCommitOnBranch: { commit: { oid: "deadbeef" } } } });
    }),
  );
  const { sheet, onCommitted, onChangePath } = await renderCreateSheet({});
  fireEvent.click(sheet.getByRole("radio", { name: /directly/i }));
  fireEvent.click(sheet.getByRole("button", { name: "Create file" }));

  const notice = within(await sheet.findByRole("alert"));
  expect(notice.getByText("This file already exists")).toBeTruthy();
  expect(notice.queryByRole("button", { name: /new branch/i })).toBeNull();
  fireEvent.click(notice.getByRole("button", { name: "Change file name" }));
  expect(onChangePath).toHaveBeenCalledTimes(1);
  expect(onCommitted).not.toHaveBeenCalled();
  expect(writes).toBe(0);
});

it("offers retry and new branch after a head-moved race during direct creation", async () => {
  let commits = 0;
  server.use(
    github.query("CheckNewFilePath", () => HttpResponse.json(createCheckResult())),
    github.mutation("CommitFileEdit", () => {
      commits++;
      if (commits === 1) {
        const errors = [{ type: "STALE_DATA", message: "Expected branch to point to old oid" }];
        return HttpResponse.json({ errors });
      }
      return HttpResponse.json({
        data: { createCommitOnBranch: { commit: { oid: "cafebabe" } } },
      });
    }),
  );
  const onCommitted = vi.fn();
  const { sheet } = await renderCreateSheet({ path: "src/fresh.ts", onCommitted });
  fireEvent.click(sheet.getByRole("radio", { name: /directly/i }));
  fireEvent.click(sheet.getByRole("button", { name: "Create file" }));

  const notice = within(await sheet.findByRole("alert"));
  expect(notice.getByText("Branch changed before committing")).toBeTruthy();
  expect(notice.getByRole("button", { name: "Commit to a new branch instead" })).toBeTruthy();
  fireEvent.click(notice.getByRole("button", { name: "Try again" }));
  await act(async () => {
    await vi.waitFor(() => {
      expect(onCommitted).toHaveBeenCalledWith(
        {
          kind: "commit",
          owner: "octo-org",
          repo: "hello-mobile",
          oid: "cafebabe",
        },
        true,
      );
    });
  });
  expect(commits).toBe(2);
});

it("reports read-only repository failures accurately instead of branch protection", async () => {
  server.use(
    github.query("CheckNewFilePath", () =>
      HttpResponse.json(createCheckResult({ isArchived: true })),
    ),
  );
  const { sheet, onCommitted } = await renderCreateSheet({ path: "src/fresh.ts" });
  fireEvent.click(sheet.getByRole("radio", { name: /directly/i }));
  fireEvent.click(sheet.getByRole("button", { name: "Create file" }));

  const notice = within(await sheet.findByRole("alert"));
  expect(notice.getByText("This repository is read-only")).toBeTruthy();
  expect(notice.queryByRole("button", { name: /new branch/i })).toBeNull();
  expect(onCommitted).not.toHaveBeenCalled();
});

it("offers only direct commits when pull requests are disabled", async () => {
  const { sheet } = await renderCreateSheet({ canProposePull: false });
  expect(sheet.queryByRole("radio")).toBeNull();
  expect(sheet.queryByRole("textbox", { name: "New branch name" })).toBeNull();
  expect(sheet.getByText("Commit directly to main")).toBeTruthy();
  expect(sheet.getByRole("button", { name: "Create file" })).toBeTruthy();
});
