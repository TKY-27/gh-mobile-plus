import { isJsonObject, property } from "../internal/json";
import { parseRepositoryYaml } from "../internal/yaml";

interface InputBase {
  name: string;
  description: string | null;
  required: boolean;
}

export type DispatchInput =
  | (InputBase & { type: "string"; default: string })
  | (InputBase & { type: "number"; default: number | null })
  | (InputBase & { type: "boolean"; default: boolean })
  | (InputBase & { type: "choice"; options: readonly string[]; default: string | null })
  | (InputBase & { type: "environment"; default: string | null });

const DISPATCH_EVENT = "workflow_dispatch";

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function numberDefault(value: unknown): number | null {
  const text = scalarText(value);
  const number = text === null || text.trim() === "" ? Number.NaN : Number(text);
  return Number.isFinite(number) ? number : null;
}

function dispatchInput(name: string, spec: unknown): DispatchInput {
  const base: InputBase = {
    name,
    description: scalarText(property(spec, "description")),
    required: property(spec, "required") === true,
  };
  const fallback = property(spec, "default");
  switch (property(spec, "type")) {
    case "boolean":
      return { ...base, type: "boolean", default: fallback === true || fallback === "true" };
    case "number":
      return { ...base, type: "number", default: numberDefault(fallback) };
    case "choice": {
      const options = property(spec, "options");
      return {
        ...base,
        type: "choice",
        options: Array.isArray(options)
          ? options.flatMap((option) => scalarText(option) ?? [])
          : [],
        default: scalarText(fallback),
      };
    }
    case "environment":
      return { ...base, type: "environment", default: scalarText(fallback) };
    default:
      // GitHub treats unknown types as string.
      return { ...base, type: "string", default: scalarText(fallback) ?? "" };
  }
}

export function parseDispatchInputs(workflowYaml: string): readonly DispatchInput[] | null {
  const workflow = parseRepositoryYaml(workflowYaml, "workflow");
  const triggers = property(workflow, "on");
  if (triggers === DISPATCH_EVENT) return [];
  if (Array.isArray(triggers)) return triggers.includes(DISPATCH_EVENT) ? [] : null;
  if (!isJsonObject(triggers) || !Object.hasOwn(triggers, DISPATCH_EVENT)) return null;
  const inputs = property(triggers[DISPATCH_EVENT], "inputs");
  if (!isJsonObject(inputs)) return [];
  return Object.entries(inputs).map(([name, spec]) => dispatchInput(name, spec));
}
