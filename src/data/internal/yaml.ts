import { parse, YAMLError } from "yaml";
import { gitHubFailure } from "./errors";

export function parseRepositoryYaml(text: string, field: string): unknown {
  try {
    const document: unknown = parse(text);
    return document;
  } catch (error) {
    // `yaml` throws ReferenceError for alias abuse.
    if (!(error instanceof YAMLError) && !(error instanceof ReferenceError)) throw error;
    throw gitHubFailure({ kind: "validation", message: error.message, fields: [field] });
  }
}
