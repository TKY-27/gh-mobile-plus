import { describe, expect, it } from "vitest";
import issueTemplates from "./fixtures/issue-templates.json";
import { parseIssueTemplate } from "./templates";

function fixtureText(name: string): string {
  const entry = issueTemplates.data.repository.object.entries.find(
    (candidate) => candidate.name === name,
  );
  const text = entry && "text" in entry.object ? entry.object.text : undefined;
  if (typeof text !== "string") throw new Error(`Missing fixture ${name}`);
  return text;
}

describe("issue templates", () => {
  it("reads Markdown front matter and keeps the body", () => {
    expect(parseIssueTemplate("bug_report.md", fixtureText("bug_report.md"))).toEqual({
      kind: "markdown",
      fileName: "bug_report.md",
      name: "Bug report",
      about: "Report something that does not work",
      title: "[Bug] ",
      body: "\n**Describe the bug**\nA clear description of what happened.\n\n**Steps to reproduce**\n1. Open the app\n",
      labels: ["bug", "triage"],
    });
  });

  it("maps every supported form field", () => {
    expect(parseIssueTemplate("feature_request.yml", fixtureText("feature_request.yml"))).toEqual({
      kind: "form",
      fileName: "feature_request.yml",
      name: "Feature request",
      description: "Suggest an idea for GH Mobile+",
      title: "[Feature]: ",
      labels: ["enhancement"],
      fields: [
        { type: "markdown", value: "Thanks for taking the time to suggest a feature!" },
        {
          type: "input",
          id: "summary",
          label: "Summary",
          description: "One line describing the feature.",
          placeholder: "Swipe to archive in Inbox",
          value: "",
          required: true,
        },
        {
          type: "textarea",
          id: "details",
          label: "Details",
          description: null,
          placeholder: null,
          value: "",
          render: "markdown",
          required: false,
        },
        {
          type: "dropdown",
          id: "platforms",
          label: "Platforms",
          description: null,
          options: ["iOS", "Android"],
          defaultOption: null,
          multiple: true,
          required: false,
        },
        {
          type: "checkboxes",
          id: "terms",
          label: "Checklist",
          description: null,
          options: [
            { label: "I searched existing issues", required: true },
            { label: "I can help implement this", required: false },
          ],
        },
      ],
    });
  });

  it("marks forms with other field types as unsupported", () => {
    expect(parseIssueTemplate("crash_report.yml", fixtureText("crash_report.yml"))).toEqual({
      kind: "unsupported",
      fileName: "crash_report.yml",
      name: "Crash report",
    });
  });

  it("skips config files, other files and Markdown without front matter", () => {
    expect(parseIssueTemplate("config.yml", fixtureText("config.yml"))).toBeNull();
    expect(parseIssueTemplate("CONFIG.yaml", "blank_issues_enabled: true")).toBeNull();
    expect(parseIssueTemplate("notes.txt", "hello")).toBeNull();
    expect(parseIssueTemplate("plain.md", "# Just a heading")).toBeNull();
  });

  it("treats malformed or hostile YAML as unsupported", () => {
    const aliasBomb = [
      "name: Bomb",
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]",
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]",
      "d: [*c,*c,*c,*c,*c,*c,*c,*c,*c]",
    ].join("\n");
    expect(parseIssueTemplate("bomb.yml", aliasBomb)).toEqual({
      kind: "unsupported",
      fileName: "bomb.yml",
      name: "bomb.yml",
    });
    expect(parseIssueTemplate("broken.yaml", "name: [")).toMatchObject({ kind: "unsupported" });
    expect(parseIssueTemplate("broken.md", "---\nname: [\n---\nbody")).toMatchObject({
      kind: "unsupported",
      name: "broken.md",
    });
  });

  it("rejects wrongly typed values instead of guessing", () => {
    const numericLabel = "name: Typed\nbody:\n  - type: input\n    attributes:\n      label: 5\n";
    expect(parseIssueTemplate("typed.yml", numericLabel)).toEqual({
      kind: "unsupported",
      fileName: "typed.yml",
      name: "Typed",
    });
    expect(parseIssueTemplate("nobody.yml", "name: No body")).toMatchObject({
      kind: "unsupported",
      name: "No body",
    });
  });

  it("derives ids for fields without one", () => {
    const form = "name: Ids\nbody:\n  - type: textarea\n    attributes:\n      label: Logs\n";
    expect(parseIssueTemplate("ids.yml", form)).toMatchObject({
      fields: [{ type: "textarea", id: "textarea-0", label: "Logs" }],
    });
  });
});
