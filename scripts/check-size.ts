import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const INITIAL_JS_BUDGET_BYTES = 170_000;
const BUILD_DIRECTORY = resolve("dist");
type Chunk = { file: string; imports: string[]; isEntry: boolean };

function parseManifest(contents: string): Map<string, Chunk> {
  const manifest: unknown = JSON.parse(contents);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("Build manifest must be an object");
  }
  const chunks = new Map<string, Chunk>();
  for (const [key, candidate] of Object.entries(manifest)) {
    const chunk: unknown = candidate;
    if (
      typeof chunk !== "object" ||
      chunk === null ||
      !("file" in chunk) ||
      typeof chunk.file !== "string"
    ) {
      throw new Error(`Invalid manifest chunk: ${key}`);
    }
    const imports: unknown = "imports" in chunk ? chunk.imports : [];
    if (
      !Array.isArray(imports) ||
      !imports.every((entry): entry is string => typeof entry === "string")
    ) {
      throw new Error(`Invalid static imports: ${key}`);
    }
    chunks.set(key, {
      file: chunk.file,
      imports,
      isEntry: "isEntry" in chunk && chunk.isEntry === true,
    });
  }
  return chunks;
}

const chunks = parseManifest(
  await readFile(resolve(BUILD_DIRECTORY, ".vite/manifest.json"), "utf8"),
);
const entries = [...chunks].filter(([, chunk]) => chunk.isEntry).map(([key]) => key);
if (!entries.length) throw new Error("Build manifest contains no entry chunk");
const visited = new Set<string>();
const files = new Set<string>();
while (entries.length) {
  const key = entries.pop();
  if (key === undefined || visited.has(key)) continue;
  visited.add(key);
  const chunk = chunks.get(key);
  if (!chunk) throw new Error(`Missing static import: ${key}`);
  files.add(chunk.file);
  entries.push(...chunk.imports);
}
const gzipSizes = await Promise.all(
  [...files].map(
    async (file) => gzipSync(await readFile(resolve(BUILD_DIRECTORY, file))).byteLength,
  ),
);
const initialBytes = gzipSizes.reduce((total, bytes) => total + bytes, 0);
console.log(
  `Initial JavaScript: ${String(initialBytes)} bytes gzip / ${String(INITIAL_JS_BUDGET_BYTES)} bytes`,
);
if (initialBytes > INITIAL_JS_BUDGET_BYTES) {
  console.error(
    `Initial JavaScript exceeds the ${String(INITIAL_JS_BUDGET_BYTES)}-byte gzip budget`,
  );
  process.exitCode = 1;
}
