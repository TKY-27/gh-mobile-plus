import { describe, expect, it } from "vitest";
import { applyCompletion, completionAt } from "./autocomplete.ts";

describe("completionAt", () => {
  it("finds a mention being typed at the caret", () => {
    expect(completionAt("Thanks @mo", 10)).toEqual({
      trigger: "@",
      query: "mo",
      start: 7,
      end: 10,
    });
  });

  it("finds a bare reference trigger", () => {
    expect(completionAt("Fixes #", 7)).toEqual({ trigger: "#", query: "", start: 6, end: 7 });
  });

  it("ignores triggers inside words such as email addresses", () => {
    expect(completionAt("mail me@example", 15)).toBeNull();
    expect(completionAt("issue#12", 8)).toBeNull();
  });

  it("ignores a caret inside a word", () => {
    expect(completionAt("@mona", 3)).toBeNull();
  });

  it("accepts a trigger after an opening parenthesis", () => {
    expect(completionAt("(see #4", 7)?.query).toBe("4");
  });

  it("stops at whitespace after the token", () => {
    expect(completionAt("@mona ", 6)).toBeNull();
  });
});

describe("applyCompletion", () => {
  it("replaces the token and places the caret after a space", () => {
    const query = completionAt("cc @mo please", 6);
    if (!query) throw new Error("expected a completion");
    expect(applyCompletion("cc @mo please", query, "mona")).toEqual({
      text: "cc @mona please",
      caret: 9,
    });
  });

  it("completes a reference at the end of the text", () => {
    const query = completionAt("Fixes #4", 8);
    if (!query) throw new Error("expected a completion");
    expect(applyCompletion("Fixes #4", query, "42")).toEqual({ text: "Fixes #42 ", caret: 10 });
  });
});
