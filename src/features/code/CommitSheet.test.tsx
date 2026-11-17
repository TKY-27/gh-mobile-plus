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

vi.mock("@/data/session", () => ({ useActiveAccount: () => ({ id: 320 }) }));

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
