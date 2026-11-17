import { describe, expect, it } from "vitest";
import type { PullRequestDetail } from "@/data/pulls";
import { canMerge } from "./MergeStatus.tsx";

const MERGE: PullRequestDetail["merge"] = {
  mergeable: "mergeable",
  state: "clean",
  blockedReasons: [],
  allowedMethods: ["squash"],
  defaultMethod: "squash",
  viewerCanMerge: true,
  defaultTitle: { squash: "t", merge: "t", rebase: "" },
  defaultMessage: { squash: "", merge: "", rebase: "" },
  canDeleteHeadBranch: true,
};

describe("canMerge", () => {
  it("allows a clean, mergeable pull request", () => {
    expect(canMerge({ state: "open", merge: MERGE })).toBe(true);
  });

  it("waits while GitHub is still computing mergeability", () => {
    expect(canMerge({ state: "open", merge: { ...MERGE, mergeable: "unknown" } })).toBe(false);
  });

  it("blocks on reasons, conflicts, permission and closed state", () => {
    expect(canMerge({ state: "open", merge: { ...MERGE, blockedReasons: ["behind"] } })).toBe(
      false,
    );
    expect(canMerge({ state: "open", merge: { ...MERGE, mergeable: "conflicting" } })).toBe(false);
    expect(canMerge({ state: "open", merge: { ...MERGE, viewerCanMerge: false } })).toBe(false);
    expect(canMerge({ state: "closed", merge: MERGE })).toBe(false);
  });
});
