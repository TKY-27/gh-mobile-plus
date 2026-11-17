import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT = new URL("../src/features/settings/licenses.json", import.meta.url);
const PACKAGE_MANIFEST = new URL("../package.json", import.meta.url);
const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ListedPackage {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
}

interface PackageLicense {
  name: string;
  version: string;
  license: string;
  text: string | null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isListedPackage(value: unknown): value is ListedPackage {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "license" in value &&
    typeof value.license === "string" &&
    "versions" in value &&
    isStringArray(value.versions) &&
    "paths" in value &&
    isStringArray(value.paths)
  );
}

function parseListing(stdout: string): ListedPackage[] {
  const listing: unknown = JSON.parse(stdout);
  if (typeof listing !== "object" || listing === null || Array.isArray(listing)) {
    throw new Error("pnpm licenses output must be an object keyed by license");
  }
  return Object.values(listing).flatMap((group: unknown) => {
    if (!Array.isArray(group) || !group.every(isListedPackage)) {
      throw new Error("Unexpected pnpm licenses entry");
    }
    return group;
  });
}

// Install paths stay local; only text ships.
async function readLicenseText(directory: string | undefined): Promise<string | null> {
  if (directory === undefined) return null;
  const file = (await readdir(directory)).sort().find((name) => LICENSE_FILE.test(name));
  if (file === undefined) return null;
  return (await readFile(join(directory, file), "utf8")).trimEnd();
}

const stdout = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: MAX_OUTPUT_BYTES,
});
const packages: PackageLicense[] = await Promise.all(
  parseListing(stdout).map(async (listed) => ({
    name: listed.name,
    version: listed.versions.join(", "),
    license: listed.license,
    text: await readLicenseText(listed.paths[0]),
  })),
);
packages.sort((a, b) => a.name.localeCompare(b.name, "en"));
const manifest: unknown = JSON.parse(await readFile(PACKAGE_MANIFEST, "utf8"));
if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
  throw new Error("package.json has no version");
}
const appVersion = String(manifest.version);
await writeFile(OUTPUT, `${JSON.stringify({ appVersion, packages }, null, 2)}\n`);
