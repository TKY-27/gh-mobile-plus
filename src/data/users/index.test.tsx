import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildSchema, execute, parse, validate } from "graphql";
import schemaSource from "../../../schema/github.graphql?raw";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { property } from "../internal/json";
import { installBrowserDoubles, persistedText } from "../internal/test-doubles";
import profile from "./fixtures/profile.json";
import otherProfile from "./fixtures/other-profile.json";
import organizationProfile from "./fixtures/organization-profile.json";
import repositories from "./fixtures/repositories.json";
import starred from "./fixtures/starred.json";
import organizations from "./fixtures/organizations.json";
import members from "./fixtures/members.json";
import readme from "./fixtures/readme.json";

const API = "https://api.github.com";
const schema = buildSchema(schemaSource, { assumeValid: true });
const accounts = [
  {
    id: 1,
    login: "mona",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    publicOnly: false,
  },
];
const requests: { query: string; variables: unknown }[] = [];
const server = setupServer(
  http.get("/auth/accounts", () => HttpResponse.json(accounts)),
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_fixture", expiresAt: Date.now() + 3_600_000 }),
  ),
  http.post(`${API}/graphql`, async ({ request }) => {
    const body: unknown = await request.json();
    const query = property(body, "query");
    const variables = property(body, "variables");
    if (typeof query !== "string") return new HttpResponse(null, { status: 400 });
    requests.push({ query, variables });
    if (query.includes("query Profile")) {
      const login = property(variables, "login");
      return HttpResponse.json(
        login === "octo-org" ? organizationProfile : login === "hubot" ? otherProfile : profile,
      );
    }
    if (query.includes("query RepositoriesOf"))
      return HttpResponse.json(property(variables, "starred") === true ? starred : repositories);
    if (query.includes("query ViewerOrganizations")) return HttpResponse.json(organizations);
    if (query.includes("query OrganizationMembers")) return HttpResponse.json(members);
    return new HttpResponse(null, { status: 400 });
  }),
  http.get(`${API}/repos/mona/mona/readme`, ({ request }) => {
    expect(request.headers.get("Accept")).toBe("application/vnd.github.html+json");
    return HttpResponse.text(readme.html, {
      headers: { "Content-Type": "application/vnd.github.html+json; charset=utf-8" },
    });
  }),
);

async function setup() {
  vi.resetModules();
  const session = await import("../session");
  const users = await import("./index");
  const query = await import("@tanstack/react-query");
  function SignedIn(props: { children: ReactNode }): ReactNode {
    return session.useSession().activeAccount ? props.children : null;
  }
  function Wrapper(props: { children: ReactNode }): ReactNode {
    return (
      <session.SessionProvider>
        <SignedIn>{props.children}</SignedIn>
      </session.SessionProvider>
    );
  }
  function useProfileWithReadme(login: string) {
    const profileQuery = users.useProfile(login);
    const readmeQuery = users.useProfileReadme(
      profileQuery.data?.login ?? login,
      profileQuery.data?.hasPublicReadmeRepository === true,
    );
    return { profileQuery, readmeQuery };
  }
  return { users, query, Wrapper, useProfileWithReadme };
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  requests.length = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  for (const { query } of requests)
    expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([]);
});
afterAll(() => {
  server.close();
});

describe("user queries", () => {
  it("never selects an organization's namesake repository or README", async () => {
    let repositoryReads = 0;
    let readmeReads = 0;
    server.use(
      http.post(`${API}/graphql`, async ({ request }) => {
        const body: unknown = await request.json();
        const query = property(body, "query");
        if (typeof query !== "string") return new HttpResponse(null, { status: 400 });
        return HttpResponse.json(
          await execute({
            schema,
            document: parse(query),
            variableValues: { login: "octo-org" },
            rootValue: {
              repositoryOwner: {
                ...organizationProfile.data.repositoryOwner,
                pinnedItems: { nodes: [] },
                repository: () => {
                  repositoryReads++;
                  return { isPrivate: false };
                },
              },
            },
          }),
        );
      }),
      http.get(`${API}/repos/octo-org/octo-org/readme`, () => {
        readmeReads++;
        return HttpResponse.html("<p>Organization repository</p>");
      }),
    );
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("octo-org"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.profileQuery.isSuccess).toBe(true);
    });
    expect(result.current.readmeQuery.fetchStatus).toBe("idle");
    expect(result.current.readmeQuery.data).toBeUndefined();
    expect(repositoryReads).toBe(0);
    expect(readmeReads).toBe(0);
  });

  it("does not expose a private namesake repository README", async () => {
    const privateProfile = structuredClone(profile);
    privateProfile.data.repositoryOwner.repository.isPrivate = true;
    let readmeReads = 0;
    server.use(
      http.post(`${API}/graphql`, () => HttpResponse.json(privateProfile)),
      http.get(`${API}/repos/mona/mona/readme`, () => {
        readmeReads++;
        return HttpResponse.html("<p>Private README</p>");
      }),
    );
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("mona"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.profileQuery.isSuccess).toBe(true);
    });
    expect(result.current.readmeQuery.fetchStatus).toBe("idle");
    expect(result.current.readmeQuery.data).toBeUndefined();
    expect(readmeReads).toBe(0);
  });

  it("maps profile and pinned repositories with rendered README", async () => {
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("mona"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.profileQuery.isSuccess).toBe(true);
    });
    expect(result.current.profileQuery.data).toMatchObject({
      login: "mona",
      name: "Mona Octocat",
      followers: 42,
      following: 7,
      isViewer: true,
      isOrganization: false,
      pinned: [
        {
          owner: "octo-org",
          name: "hello-mobile",
          stars: 128,
          language: { name: "TypeScript", color: "#3178c6" },
        },
      ],
    });
    await waitFor(() => {
      expect(result.current.readmeQuery.data).toBe(readme.html);
    });
    expect(requests).toHaveLength(1);
  });

  it("saves only profile basics with private offline content disabled", async () => {
    localStorage.setItem("ghm-preferences", JSON.stringify({ keepPrivateOffline: false }));
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("mona"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.readmeQuery.data).toBe(readme.html);
    });
    await waitFor(
      async () => {
        const stored = await persistedText();
        expect(stored).toContain('"bio":"Building mobile tools"');
        expect(stored).not.toContain("hello-mobile");
        expect(stored).not.toContain("<article>");
      },
      { timeout: 3000 },
    );
    expect(result.current.profileQuery.data?.pinned[0]?.name).toBe("hello-mobile");
  });

  it("loads an organization without requesting a missing profile repository", async () => {
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("octo-org"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.profileQuery.isSuccess).toBe(true);
    });
    expect(result.current.profileQuery.data).toMatchObject({
      login: "octo-org",
      bio: "Building together",
      company: null,
      followers: 0,
      following: 0,
      isOrganization: true,
    });
    expect(requests).toHaveLength(1);
  });

  it("treats an absent README as optional and preserves other failures", async () => {
    server.use(
      http.get(`${API}/repos/mona/mona/readme`, () => new HttpResponse(null, { status: 404 })),
    );
    const { useProfileWithReadme, Wrapper } = await setup();
    const { result } = renderHook(() => useProfileWithReadme("mona"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.readmeQuery.data).toBeNull();
    });
    server.use(
      http.get(`${API}/repos/mona/mona/readme`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    await act(async () => {
      const denied = await result.current.readmeQuery.refetch();
      expect(denied.error?.kind).toBe("forbidden");
    });
    expect(result.current.profileQuery.data?.login).toBe("mona");
  });

  it("returns notFound for a missing owner", async () => {
    server.use(
      http.post(`${API}/graphql`, () => HttpResponse.json({ data: { repositoryOwner: null } })),
    );
    const { users, Wrapper } = await setup();
    const { result } = renderHook(() => users.useProfile("missing"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.error?.kind).toBe("notFound");
    });
  });

  it("pages owned repositories and maps starred repositories", async () => {
    const { users, Wrapper } = await setup();
    const { result } = renderHook(
      () => ({
        owned: users.useRepositoriesOf("octo-org", "owned"),
        starred: users.useRepositoriesOf("mona", "starred"),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.owned.isSuccess && result.current.starred.isSuccess).toBe(true);
    });
    expect(result.current.owned.data?.pages[0]?.items).toEqual([
      {
        owner: "octo-org",
        name: "hello-mobile",
        description: "A mobile GitHub client fixture",
        isPrivate: false,
        isFork: false,
        stars: 128,
        language: { name: "TypeScript", color: "#3178c6" },
        updatedAt: "2026-11-16T10:30:00Z",
      },
    ]);
    expect(result.current.starred.hasNextPage).toBe(false);
    await act(async () => {
      await result.current.owned.fetchNextPage();
    });
    expect(requests.at(-1)?.variables).toMatchObject({
      login: "octo-org",
      cursor: "repo-cursor-1",
      owned: true,
      starred: false,
    });
    await waitFor(() => {
      expect(result.current.owned.data?.pages).toHaveLength(2);
    });
  });

  it("passes requested repository and starred sort orders", async () => {
    const { users, Wrapper } = await setup();
    const { result } = renderHook(
      () => ({
        owned: users.useRepositoriesOf("octo-org", "owned", "stars"),
        starred: users.useRepositoriesOf("mona", "starred", "oldest"),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.owned.isSuccess && result.current.starred.isSuccess).toBe(true);
    });
    expect(
      requests.some((req) =>
        JSON.stringify(req.variables).includes('"field":"STARGAZERS","direction":"DESC"'),
      ),
    ).toBe(true);
    expect(
      requests.some((req) =>
        JSON.stringify(req.variables).includes('"field":"STARRED_AT","direction":"ASC"'),
      ),
    ).toBe(true);
  });

  it("loads viewer organizations and pages organization members", async () => {
    const { users, Wrapper } = await setup();
    const { result } = renderHook(
      () => ({
        organizations: users.useViewerOrganizations(),
        members: users.useOrganizationMembers("octo-org"),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.organizations.isSuccess && result.current.members.isSuccess).toBe(true);
    });
    expect(result.current.organizations.data).toEqual([
      {
        login: "octo-org",
        name: "Octo Organization",
        viewerCanCreateRepositories: true,
        avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4",
      },
    ]);
    expect(result.current.members.data?.pages[0]?.items).toEqual([
      { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    ]);
    await act(async () => {
      await result.current.members.fetchNextPage();
    });
    expect(requests.at(-1)?.variables).toMatchObject({
      org: "octo-org",
      cursor: "member-cursor-1",
    });
  });
});

describe("following", () => {
  it("updates target and viewer counts immediately then rolls back a failed write", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    server.use(
      http.put(`${API}/user/following/hubot`, async () => {
        writes++;
        await pending;
        return HttpResponse.json({ message: "Resource not accessible" }, { status: 403 });
      }),
    );
    const { users, query, Wrapper } = await setup();
    const { result } = renderHook(
      () => ({
        target: users.useProfile("hubot"),
        viewer: users.useProfile("mona"),
        follow: users.useFollow(),
        queryClient: query.useQueryClient(),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.target.isSuccess && result.current.viewer.isSuccess).toBe(true);
    });
    result.current.queryClient.setQueryData([1, "home", "viewer"], { following: 7 });
    act(() => {
      result.current.follow.mutate({ login: "hubot", follow: true });
    });
    await waitFor(() => {
      expect(result.current.target.data).toMatchObject({ viewerIsFollowing: true, followers: 11 });
      expect(result.current.viewer.data?.following).toBe(8);
    });
    release?.();
    await waitFor(() => {
      expect(result.current.follow.isError).toBe(true);
    });
    expect(result.current.target.data).toMatchObject({ viewerIsFollowing: false, followers: 10 });
    expect(result.current.viewer.data?.following).toBe(7);
    expect(result.current.queryClient.getQueryState([1, "home", "viewer"])?.isInvalidated).toBe(
      true,
    );
    expect(writes).toBe(1);
  });

  it("sends DELETE for unfollowing", async () => {
    let unfollowed = false;
    server.use(
      http.delete(`${API}/user/following/hubot`, () => {
        unfollowed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { users, Wrapper } = await setup();
    const { result } = renderHook(() => users.useFollow(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    await act(async () => {
      await result.current.mutateAsync({ login: "hubot", follow: false });
    });
    expect(unfollowed).toBe(true);
  });
});
