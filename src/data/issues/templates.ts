import { isGitHubError } from "../errors";
import { property, stringProperty } from "../internal/json";
import { parseRepositoryYaml } from "../internal/yaml";
import type { IssueFormField, IssueTemplate } from "./forms";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/;
const MARKDOWN_FILE = /\.md$/i;
const FORM_FILE = /\.ya?ml$/i;
const CONFIG_FILE = /^config\.ya?ml$/i;

class UnsupportedTemplate extends Error {}

function parseYaml(text: string, fileName: string): unknown {
  try {
    return parseRepositoryYaml(text, fileName);
  } catch (error) {
    // Malformed YAML needs the GitHub fallback.
    if (isGitHubError(error) && error.kind === "validation") {
      throw new UnsupportedTemplate(error.message);
    }
    throw error;
  }
}

function optionalString(value: unknown, name: string): string | null {
  const found = property(value, name);
  if (found === undefined || found === null) return null;
  if (typeof found !== "string") throw new UnsupportedTemplate(`${name} is not a string`);
  return found;
}

function requiredString(value: unknown, name: string): string {
  const found = optionalString(value, name);
  if (found === null) throw new UnsupportedTemplate(`${name} is missing`);
  return found;
}

function optionalBoolean(value: unknown, name: string): boolean {
  const found = property(value, name);
  if (found === undefined || found === null) return false;
  if (typeof found !== "boolean") throw new UnsupportedTemplate(`${name} is not a boolean`);
  return found;
}

function list(value: unknown, name: string): unknown[] {
  const found = property(value, name);
  if (!Array.isArray(found)) throw new UnsupportedTemplate(`${name} is not a list`);
  return found;
}

// GitHub accepts lists or comma-separated strings.
function labelNames(value: unknown): string[] {
  const labels = property(value, "labels");
  if (labels === undefined || labels === null) return [];
  const names: unknown = typeof labels === "string" ? labels.split(",") : labels;
  if (!Array.isArray(names)) throw new UnsupportedTemplate("labels is not a list");
  return names.flatMap((name: unknown) => {
    if (typeof name !== "string") throw new UnsupportedTemplate("label is not a string");
    return name.trim() === "" ? [] : [name.trim()];
  });
}

function parseField(element: unknown, index: number): IssueFormField {
  const type = property(element, "type");
  const attributes = property(element, "attributes");
  if (type === "markdown") return { type, value: requiredString(attributes, "value") };
  const id = stringProperty(element, "id") ?? `${String(type)}-${String(index)}`;
  const label = requiredString(attributes, "label");
  const description = optionalString(attributes, "description");
  const required = optionalBoolean(property(element, "validations"), "required");
  switch (type) {
    case "input":
    case "textarea": {
      const placeholder = optionalString(attributes, "placeholder");
      const value = optionalString(attributes, "value") ?? "";
      if (type === "input") return { type, id, label, description, placeholder, value, required };
      const render = optionalString(attributes, "render");
      return { type, id, label, description, placeholder, value, render, required };
    }
    case "dropdown": {
      const options = list(attributes, "options").map((option) => {
        if (typeof option !== "string") throw new UnsupportedTemplate("option is not a string");
        return option;
      });
      const multiple = optionalBoolean(attributes, "multiple");
      const defaultIndex = property(attributes, "default");
      const defaultOption =
        typeof defaultIndex === "number" && Number.isInteger(defaultIndex)
          ? options[defaultIndex]
          : undefined;
      if (defaultIndex != null && defaultOption === undefined) {
        throw new UnsupportedTemplate("dropdown default is not an option index");
      }
      return {
        type,
        id,
        label,
        description,
        options,
        defaultOption: defaultOption ?? null,
        multiple,
        required,
      };
    }
    case "checkboxes": {
      const options = list(attributes, "options").map((option) => ({
        label: requiredString(option, "label"),
        required: optionalBoolean(option, "required"),
      }));
      return { type, id, label, description, options };
    }
    default:
      throw new UnsupportedTemplate(`field type ${String(type)} is not supported`);
  }
}

function markdownTemplate(fileName: string, frontMatter: unknown, body: string): IssueTemplate {
  return {
    kind: "markdown",
    fileName,
    name: optionalString(frontMatter, "name") ?? fileName,
    about: optionalString(frontMatter, "about"),
    title: optionalString(frontMatter, "title") ?? "",
    body,
    labels: labelNames(frontMatter),
  };
}

function formTemplate(fileName: string, form: unknown): IssueTemplate {
  return {
    kind: "form",
    fileName,
    name: requiredString(form, "name"),
    description: optionalString(form, "description"),
    title: optionalString(form, "title") ?? "",
    labels: labelNames(form),
    fields: list(form, "body").map(parseField),
  };
}

export function parseIssueTemplate(fileName: string, text: string): IssueTemplate | null {
  const isForm = FORM_FILE.test(fileName) && !CONFIG_FILE.test(fileName);
  if (!isForm && !MARKDOWN_FILE.test(fileName)) return null;
  const frontMatter = isForm ? null : FRONT_MATTER.exec(text);
  // GitHub ignores Markdown without front matter.
  if (!isForm && !frontMatter) return null;
  let document: unknown = null;
  try {
    document = parseYaml(isForm ? text : (frontMatter?.[1] ?? ""), fileName);
    return isForm
      ? formTemplate(fileName, document)
      : markdownTemplate(fileName, document, frontMatter?.[2] ?? "");
  } catch (error) {
    if (!(error instanceof UnsupportedTemplate)) throw error;
    return { kind: "unsupported", fileName, name: stringProperty(document, "name") ?? fileName };
  }
}
