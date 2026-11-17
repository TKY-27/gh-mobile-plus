import { describe, expect, it } from "vitest";
import { defaultBranchName } from "@/data/commit";
import { isValidBranchName } from "./branch-name.ts";
import { extendSelection } from "./CodeView.tsx";

describe("extendSelection", () => {
  it("grows the range toward the tapped line", () => {
    expect(extendSelection({ start: 5, end: 5 }, 9)).toEqual({ start: 5, end: 9 });
    expect(extendSelection({ start: 5, end: 9 }, 2)).toEqual({ start: 2, end: 9 });
  });

  it("shrinks from the end when tapping inside", () => {
    expect(extendSelection({ start: 2, end: 9 }, 4)).toEqual({ start: 2, end: 4 });
  });

  it("clears when tapping the only selected line", () => {
    expect(extendSelection({ start: 7, end: 7 }, 7)).toBeNull();
  });
});

describe("isValidBranchName", () => {
  it("accepts the generated default", () => {
    expect(isValidBranchName(defaultBranchName("mona", "src/app.ts", new Date()))).toBe(true);
    expect(isValidBranchName("feature/navigation")).toBe(true);
  });

  it.each([
    "",
    "@",
    "has space",
    "a..b",
    "a//b",
    "/lead",
    "trail/",
    "end.",
    "x.lock",
    "a~b",
    "a@{b",
    "-flag",
    "a/.hidden",
  ])("rejects %j", (name) => {
    expect(isValidBranchName(name)).toBe(false);
  });
});
