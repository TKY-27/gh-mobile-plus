import { describe, expect, it } from "vitest";
import { githubUrl, refPathCandidates, toAppPath } from "./links";

describe("toAppPath", () => {
  it("maps repository URLs, keeping encoded refs and line anchors", () => {
    expect(toAppPath("https://github.com/octocat/demo/blob/feature%2Fone/src/a.ts#L2")).toBe(
      "/octocat/demo/blob/feature%2Fone/src/a.ts#L2",
    );
    expect(toAppPath("https://github.com/octocat/demo/tree/v1.2.0/src")).toBe(
      "/octocat/demo/tree/v1.2.0/src",
    );
    expect(toAppPath("https://github.com/octocat/demo/blob/feature/login/src/app.ts#L2")).toBe(
      "/octocat/demo/blob/feature/login/src/app.ts#L2",
    );
    expect(toAppPath("https://github.com/octocat/demo/")).toBe("/octocat/demo");
    expect(toAppPath("https://www.github.com/octocat")).toBe("/octocat");
    expect(toAppPath("https://github.com/")).toBe("/");
  });

  it("maps every supported repository section", () => {
    for (const section of [
      "issues",
      "issues/new",
      "issues/12",
      "pulls",
      "pull/3",
      "pull/3/files",
      "pull/3/checks",
      "pull/3/commits",
      "actions",
      "actions/runs/99",
      "actions/runs/99/job/100",
      "releases",
      "releases/tag/v1.0.0",
      "commit/0123abc",
    ]) {
      expect(toAppPath(`https://github.com/o/r/${section}`)).toBe(`/o/r/${section}`);
    }
    expect(toAppPath("https://github.com/o/r/issues/12#issuecomment-1")).toBe(
      "/o/r/issues/12#issuecomment-1",
    );
  });

  it("maps references and mentions", () => {
    expect(toAppPath("octocat/demo#12")).toBe("/octocat/demo/issues/12");
    expect(toAppPath(" octocat/demo ")).toBe("/octocat/demo");
    expect(toAppPath("@octocat")).toBe("/octocat");
  });

  it("returns null for anything the app cannot show", () => {
    expect(toAppPath("https://github.com.attacker.example/octocat/demo")).toBeNull();
    expect(toAppPath("https://example.com/octocat/demo")).toBeNull();
    expect(toAppPath("https://user@github.com/octocat")).toBeNull();
    expect(toAppPath("javascript:alert(1)")).toBeNull();
    expect(toAppPath("https://github.com/settings/profile")).toBeNull();
    expect(toAppPath("https://github.com/auth/login")).toBeNull();
    expect(toAppPath("https://github.com/o/r/wiki")).toBeNull();
    expect(toAppPath("https://github.com/o/../settings")).toBeNull();
    expect(toAppPath("@settings")).toBeNull();
    expect(toAppPath("https://github.com/notifications?query=repo:octo/app")).toBeNull();
    expect(toAppPath("../..")).toBeNull();
    expect(toAppPath("plain words")).toBeNull();
  });
});

describe("refPathCandidates", () => {
  it("tries the longest refs first and preserves each remaining path", () => {
    expect([...refPathCandidates("feature", "login/mobile/src/app.ts", "blob")]).toEqual([
      { ref: "feature/login/mobile/src", path: "app.ts" },
      { ref: "feature/login/mobile", path: "src/app.ts" },
      { ref: "feature/login", path: "mobile/src/app.ts" },
    ]);
  });

  it("permits a branch root but requires a path for blobs", () => {
    expect([...refPathCandidates("feature", "login", "tree")]).toEqual([
      { ref: "feature/login", path: "" },
    ]);
    expect([...refPathCandidates("feature", "login", "blob")]).toEqual([]);
  });

  it("preserves the boundary of a ref encoded as one URL segment", () => {
    expect([...refPathCandidates("release/mobile", "src/app.ts", "blob")]).toEqual([]);
    expect([...refPathCandidates("refs/tags/release", "mobile", "tree")]).toEqual([]);
  });
});

describe("githubUrl", () => {
  it("is the inverse of toAppPath", () => {
    for (const url of [
      "https://github.com/notifications",
      "https://github.com/octocat?tab=followers",
      "https://github.com/octocat?tab=following",
      "https://github.com/octocat/demo/tree/main/src",
      "https://github.com/octocat/demo/pull/3/files",
      "https://github.com/octocat",
    ]) {
      expect(githubUrl(toAppPath(url) ?? "")).toBe(url);
    }
    expect(githubUrl("/")).toBe("https://github.com/");
  });

  it("rejects paths that could leave github.com", () => {
    expect(() => githubUrl("//example.com")).toThrow();
    expect(() => githubUrl("/\\example.com")).toThrow();
    expect(() => githubUrl("https://example.com")).toThrow();
  });
});
