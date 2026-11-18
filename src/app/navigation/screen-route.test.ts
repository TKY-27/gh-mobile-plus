import { describe, expect, test, vi } from "vitest";
import { matchScreen, ROOT_ROUTE_ID } from "./screen-route.ts";

const stored = new Map<string, string>();
// Router modules read storage at import time.
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
});
const { router } = await import("../router.ts");

describe("matchScreen", () => {
  test.each([
    ["/", "/"],
    ["/octo/repo", "/$owner/$repo"],
    ["/octo/repo/", "/$owner/$repo"],
    ["/octo/repo/pull/7/files", "/$owner/$repo/pull/$number/files"],
    ["/octo/repo/tree/main/src/app", "/$owner/$repo/tree/$ref/$"],
    ["/octo/repo/tree/feature%2Flogin", "/$owner/$repo/tree/$ref/$"],
    ["/repositories", "/repositories"],
    ["/notifications?filter=all", "/notifications"],
  ])("%s renders %s", (href, routeId) => {
    expect(matchScreen(router, href).match.routeId).toBe(routeId);
  });

  test.each([
    "/a/b/c/d",
    "/octo/repo/wiki/Page",
    "/octo/repo/discussions/5",
    "/octo/repo/pull/abc",
    "/octo/repo/pull/7/files/extra",
  ])("%s is not found instead of a parent screen", (href) => {
    const screen = matchScreen(router, href);
    expect(screen.match.routeId).toBe(ROOT_ROUTE_ID);
    expect(screen.component).toBeUndefined();
  });

  test("parses typed params of the exact match", () => {
    expect(matchScreen(router, "/octo/repo/issues/42").match.params).toEqual({
      owner: "octo",
      repo: "repo",
      number: 42,
    });
  });

  test("keeps an encoded slash inside the ref parameter", () => {
    expect(
      matchScreen(router, "/octo/repo/blob/feature%2Flogin/src/app.ts#L2").match.params,
    ).toEqual({
      owner: "octo",
      repo: "repo",
      ref: "feature/login",
      _splat: "src/app.ts",
      "*": "src/app.ts",
    });
  });
});
