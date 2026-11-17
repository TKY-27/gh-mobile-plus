import { readdir, readFile } from "node:fs/promises";

const MESSAGES = new URL("../src/i18n/messages/", import.meta.url);

function placeholders(message: string): string {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))]
    .sort()
    .join(",");
}

export function compareCatalogs(
  english: Record<string, string>,
  japanese: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const key of new Set([...Object.keys(english), ...Object.keys(japanese)])) {
    const en = english[key];
    const ja = japanese[key];
    if (en === undefined) problems.push(`en: missing key "${key}"`);
    else if (!en.trim()) problems.push(`en: empty value for "${key}"`);
    if (ja === undefined) problems.push(`ja: missing key "${key}"`);
    else if (!ja.trim()) problems.push(`ja: empty value for "${key}"`);
    if (en !== undefined && ja !== undefined && placeholders(en) !== placeholders(ja)) {
      problems.push(
        `Placeholder mismatch for "${key}": en={${placeholders(en)}} ja={${placeholders(ja)}}`,
      );
    }
  }
  return problems;
}

export function compareNamespaces(
  english: readonly string[],
  japanese: readonly string[],
): string[] {
  return [
    ...english.filter((name) => !japanese.includes(name)).map((name) => `ja: missing ${name}`),
    ...japanese.filter((name) => !english.includes(name)).map((name) => `en: missing ${name}`),
  ];
}

async function readNamespaces(language: string): Promise<string[]> {
  const files = await readdir(new URL(`${language}/`, MESSAGES));
  return files.filter((file) => file.endsWith(".json")).sort();
}

async function readCatalog(
  language: string,
  files: readonly string[],
): Promise<Record<string, string>> {
  const messages: Record<string, string> = {};
  for (const file of files) {
    const namespace = file.replace(/\.json$/, "");
    const catalog: unknown = JSON.parse(
      await readFile(new URL(`${language}/${file}`, MESSAGES), "utf8"),
    );
    if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
      throw new Error(`${language}/${file}: expected an object of messages`);
    }
    for (const [key, message] of Object.entries(catalog)) {
      if (typeof message !== "string") {
        throw new Error(`${language}/${file}: "${key}" must be a string`);
      }
      messages[`${namespace}.${key}`] = message;
    }
  }
  return messages;
}

if (import.meta.main) {
  const [englishFiles, japaneseFiles] = await Promise.all([
    readNamespaces("en"),
    readNamespaces("ja"),
  ]);
  const [english, japanese] = await Promise.all([
    readCatalog("en", englishFiles),
    readCatalog("ja", japaneseFiles),
  ]);
  const problems = [
    ...compareNamespaces(englishFiles, japaneseFiles),
    ...compareCatalogs(english, japanese),
  ];
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `i18n: ${String(Object.keys(english).length)} matching messages in ${String(englishFiles.length)} namespaces`,
    );
  }
}
