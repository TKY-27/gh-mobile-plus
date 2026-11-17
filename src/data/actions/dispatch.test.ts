import { describe, expect, it } from "vitest";
import { parseDispatchInputs } from "./dispatch";
import deployWorkflow from "./fixtures/deploy.yml?raw";

describe("parseDispatchInputs", () => {
  it("reads every supported input type from a workflow file", () => {
    expect(parseDispatchInputs(deployWorkflow)).toEqual([
      {
        type: "string",
        name: "version",
        description: "Version to deploy",
        required: true,
        default: "latest",
      },
      {
        type: "boolean",
        name: "dry_run",
        description: "Skip the final upload",
        required: false,
        default: true,
      },
      {
        type: "number",
        name: "replicas",
        description: "Number of replicas",
        required: false,
        default: 3,
      },
      {
        type: "choice",
        name: "region",
        description: "Target region",
        required: true,
        options: ["ap-northeast-1", "us-east-1", "eu-west-1"],
        default: "ap-northeast-1",
      },
      {
        type: "environment",
        name: "target",
        description: "Deployment environment",
        required: false,
        default: "staging",
      },
      { type: "string", name: "note", description: null, required: false, default: "" },
    ]);
  });

  it("accepts the string and list forms of `on`", () => {
    expect(parseDispatchInputs("on: workflow_dispatch\njobs: {}\n")).toEqual([]);
    expect(parseDispatchInputs("on: [push, workflow_dispatch]\n")).toEqual([]);
    expect(parseDispatchInputs("on:\n  workflow_dispatch:\n")).toEqual([]);
  });

  it("returns null without a workflow_dispatch trigger", () => {
    expect(parseDispatchInputs("on: push\n")).toBeNull();
    expect(parseDispatchInputs("on: [push, pull_request]\n")).toBeNull();
    expect(parseDispatchInputs("on:\n  schedule:\n    - cron: '0 0 * * *'\n")).toBeNull();
    expect(parseDispatchInputs("name: no triggers\n")).toBeNull();
  });

  it("normalizes quoted and missing defaults", () => {
    const inputs = parseDispatchInputs(
      [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      debug: { type: boolean, default: 'true' }",
        "      count: { type: number, default: 'many' }",
        "      tag: { type: choice, options: [1, 2] }",
        "      env: { type: environment }",
        "      label: { default: 42 }",
      ].join("\n"),
    );
    expect(inputs).toEqual([
      { type: "boolean", name: "debug", description: null, required: false, default: true },
      { type: "number", name: "count", description: null, required: false, default: null },
      {
        type: "choice",
        name: "tag",
        description: null,
        required: false,
        options: ["1", "2"],
        default: null,
      },
      { type: "environment", name: "env", description: null, required: false, default: null },
      { type: "string", name: "label", description: null, required: false, default: "42" },
    ]);
  });

  it("reports invalid YAML as a validation error", () => {
    expect(() => parseDispatchInputs("on: [push\n")).toThrow(
      expect.objectContaining({ kind: "validation", fields: ["workflow"] }),
    );
  });

  it("reports an alias bomb as a validation error", () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 0; level < 6; level++) {
      const previous = level === 0 ? "a" : `l${String(level - 1)}`;
      lines.push(
        `l${String(level)}: &l${String(level)} [${Array(10).fill(`*${previous}`).join(", ")}]`,
      );
    }
    expect(() => parseDispatchInputs(`${lines.join("\n")}\non: workflow_dispatch\n`)).toThrow(
      expect.objectContaining({ kind: "validation", fields: ["workflow"] }),
    );
  });
});
