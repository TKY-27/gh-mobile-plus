import { expect, it } from "vitest";
import {
  issueFormDefaults,
  issueFormToMarkdown,
  missingRequiredIssueFields,
  type IssueFormField,
} from "./forms";
import { parseIssueTemplate } from "./templates";

const legacyDropdown = {
  type: "dropdown",
  id: "platform",
  label: "Platform",
  description: null,
  options: ["macOS", "iOS"],
  multiple: true,
  required: true,
} as const;

it("leaves a cached dropdown without a default unanswered", () => {
  const fields = [legacyDropdown];
  const defaults = issueFormDefaults(fields);
  expect(defaults).toEqual({});
  expect(missingRequiredIssueFields(fields, defaults)).toEqual(["platform"]);
});

it("ignores missing and blank selections in validation and Markdown", () => {
  const fields = [legacyDropdown];
  const empty = [undefined, "", null, " "];
  expect(missingRequiredIssueFields(fields, { platform: empty })).toEqual(["platform"]);
  expect(issueFormToMarkdown(fields, { platform: empty })).toBe("### Platform\n\n_No response_");
  const selected = { platform: [...empty, "iOS"] };
  expect(missingRequiredIssueFields(fields, selected)).toEqual([]);
  expect(issueFormToMarkdown(fields, selected)).toBe("### Platform\n\niOS");
});

it.each([false, true])("submits a YAML dropdown default with multiple=%s", (multiple) => {
  const parsed = parseIssueTemplate(
    "device.yml",
    `name: Device report
body:
  - type: dropdown
    id: platform
    attributes:
      label: Platform
      options: [macOS, iOS]
      default: 0
      multiple: ${String(multiple)}
    validations:
      required: true`,
  );
  if (parsed?.kind !== "form") throw new Error("Expected a supported issue form");
  const defaults = issueFormDefaults(parsed.fields);
  expect(defaults).toEqual({ platform: multiple ? ["macOS"] : "macOS" });
  expect(issueFormToMarkdown(parsed.fields, defaults)).toBe("### Platform\n\nmacOS");
});

it("submits untouched text defaults and respects an explicitly cleared field", () => {
  const fields: IssueFormField[] = [
    {
      type: "input",
      id: "platform",
      label: "Platform",
      description: null,
      placeholder: null,
      value: "macOS",
      required: true,
    },
    {
      type: "textarea",
      id: "details",
      label: "Details",
      description: null,
      placeholder: null,
      value: "Reproduction steps",
      render: null,
      required: false,
    },
  ];
  const defaults = issueFormDefaults(fields);
  expect(issueFormToMarkdown(fields, defaults)).toBe(
    "### Platform\n\nmacOS\n\n### Details\n\nReproduction steps",
  );
  expect(issueFormToMarkdown(fields, { ...defaults, details: "" })).toBe(
    "### Platform\n\nmacOS\n\n### Details\n\n_No response_",
  );
});

it("renders answered and unanswered fields as issue sections", () => {
  expect(
    issueFormToMarkdown(
      [
        { type: "markdown", value: "Instructions" },
        {
          type: "input",
          id: "summary",
          label: "Summary",
          description: null,
          placeholder: null,
          value: "",
          required: true,
        },
        {
          type: "textarea",
          id: "logs",
          label: "Logs",
          description: null,
          placeholder: null,
          value: "",
          render: "text",
          required: false,
        },
        {
          type: "checkboxes",
          id: "checks",
          label: "Checks",
          description: null,
          options: [
            { label: "Searched", required: true },
            { label: "Updated", required: false },
          ],
        },
      ],
      { summary: "Broken build", checks: [true, false] },
    ),
  ).toBe(
    "### Summary\n\nBroken build\n\n### Logs\n\n_No response_\n\n### Checks\n\n- [X] Searched\n- [ ] Updated",
  );
});
