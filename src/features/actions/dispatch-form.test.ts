import { describe, expect, it } from "vitest";
import { parseDispatchInputs } from "@/data/actions";
import { buildDispatchInputs, initialValues } from "./dispatch-form.ts";

const WORKFLOW = `
on:
  workflow_dispatch:
    inputs:
      version: { required: true, default: latest }
      dry_run: { type: boolean, default: true }
      replicas: { type: number, default: 3 }
      region: { type: choice, required: true, options: [ap-northeast-1, us-east-1] }
      target: { type: environment }
      note: { type: string }
`;

function definitions() {
  const inputs = parseDispatchInputs(WORKFLOW);
  if (inputs === null) throw new Error("fixture has workflow_dispatch");
  return inputs;
}

describe("dispatch form", () => {
  it("submits defaults with typed values and omits empty optional fields", () => {
    const inputs = definitions();
    expect(buildDispatchInputs(inputs, initialValues(inputs))).toEqual({
      ok: true,
      inputs: { version: "latest", dry_run: true, replicas: 3, region: "ap-northeast-1" },
      errors: {},
    });
  });

  it("reports missing required values and malformed numbers", () => {
    const inputs = definitions();
    const values = { ...initialValues(inputs), version: "  ", replicas: "three" };
    expect(buildDispatchInputs(inputs, values)).toMatchObject({
      ok: false,
      errors: { version: "required", replicas: "number" },
    });
  });

  it("keeps edited values", () => {
    const inputs = definitions();
    const values = { ...initialValues(inputs), dry_run: false, target: "production", note: "hi" };
    expect(buildDispatchInputs(inputs, values).inputs).toMatchObject({
      dry_run: false,
      target: "production",
      note: "hi",
    });
  });
});
