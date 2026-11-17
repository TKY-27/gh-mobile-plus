import { describe, expect, it } from "vitest";
import { checkRunState, countByGroup, statusContextState } from "./check-state.ts";

describe("check states", () => {
  it("treats unfinished runs as pending regardless of conclusion", () => {
    expect(checkRunState({ status: "inProgress", conclusion: null })).toMatchObject({
      icon: "pending",
      label: "pull.checks.state.inProgress",
    });
    expect(checkRunState({ status: "queued", conclusion: null }).group).toBe("pending");
  });

  it("maps conclusions to icon and group", () => {
    expect(checkRunState({ status: "completed", conclusion: "timedOut" })).toMatchObject({
      icon: "failure",
      group: "failing",
    });
    expect(checkRunState({ status: "completed", conclusion: "skipped" }).group).toBe("skipped");
  });

  it("counts runs and commit statuses together", () => {
    const counts = countByGroup([
      checkRunState({ status: "completed", conclusion: "success" }),
      checkRunState({ status: "completed", conclusion: "failure" }),
      statusContextState("error"),
      statusContextState("expected"),
    ]);
    expect(counts).toEqual({ failing: 2, pending: 1, passing: 1, skipped: 0 });
  });
});
