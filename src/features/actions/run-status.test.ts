import { describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n/index.tsx";
import catalog from "@/i18n/en.ts";
import { eventLabel, formatDuration, runState } from "./run-status.ts";

const messages = new Map(
  Object.entries(catalog).flatMap(([namespace, entries]) =>
    Object.entries<string>(entries).map(([key, message]) => [`${namespace}.${key}`, message]),
  ),
);
const t = createTranslator("en", messages);
const START = "2026-11-17T10:00:00Z";

describe("formatDuration", () => {
  it("is null before the work starts", () => {
    expect(formatDuration(t, null, null, Date.parse(START))).toBeNull();
  });

  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(t, START, "2026-11-17T10:00:42Z", 0)).toBe("42s");
    expect(formatDuration(t, START, "2026-11-17T10:03:05Z", 0)).toBe("3m 5s");
    expect(formatDuration(t, START, "2026-11-17T12:07:00Z", 0)).toBe("2h 7m");
  });

  it("measures running work against now", () => {
    expect(formatDuration(t, START, null, Date.parse("2026-11-17T10:01:00Z"))).toBe("1m 0s");
  });
});

describe("runState", () => {
  it("pairs every state with an icon", () => {
    expect(runState("in_progress", null)).toEqual({
      icon: "pending",
      label: "actions.status.inProgress",
    });
    expect(runState("completed", "timed_out").icon).toBe("failure");
    expect(runState("completed", "cancelled").icon).toBe("closed");
  });
});

describe("eventLabel", () => {
  it("localizes known events and spaces out unknown ones", () => {
    expect(eventLabel(t, "pull_request")).toBe("Pull request");
    expect(eventLabel(t, "workflow_dispatch")).toBe("Manual run");
    expect(eventLabel(t, "check_suite")).toBe("check suite");
  });
});
