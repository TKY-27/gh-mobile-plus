import type { DispatchInput } from "@/data/actions";

export type FieldValues = Readonly<Record<string, string | boolean>>;
export type FieldProblem = "required" | "number";

export interface BuiltInputs {
  ok: boolean;
  inputs: Readonly<Record<string, string | number | boolean>>;
  errors: Readonly<Record<string, FieldProblem>>;
}

function initialValue(input: DispatchInput): string | boolean {
  switch (input.type) {
    case "boolean":
      return input.default;
    case "number":
      return input.default === null ? "" : String(input.default);
    case "choice":
      return input.default ?? (input.required ? (input.options[0] ?? "") : "");
    case "environment":
      return input.default ?? "";
    case "string":
      return input.default;
  }
}

export function initialValues(inputs: readonly DispatchInput[]): FieldValues {
  return Object.fromEntries(inputs.map((input) => [input.name, initialValue(input)]));
}

// Omission preserves workflow defaults.
export function buildDispatchInputs(
  definitions: readonly DispatchInput[],
  values: FieldValues,
): BuiltInputs {
  const inputs: Record<string, string | number | boolean> = {};
  const errors: Record<string, FieldProblem> = {};
  for (const definition of definitions) {
    const value = values[definition.name] ?? initialValue(definition);
    if (typeof value === "boolean") {
      inputs[definition.name] = value;
      continue;
    }
    if (value.trim() === "") {
      if (definition.required) errors[definition.name] = "required";
      continue;
    }
    if (definition.type !== "number") {
      inputs[definition.name] = value;
      continue;
    }
    const number = Number(value.trim());
    if (Number.isFinite(number)) inputs[definition.name] = number;
    else errors[definition.name] = "number";
  }
  return { ok: Object.keys(errors).length === 0, inputs, errors };
}
