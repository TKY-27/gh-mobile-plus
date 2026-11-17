import { expect, test } from "vitest";
import { isChunkLoadError } from "./ScreenBoundary.tsx";

test.each([
  "Failed to fetch dynamically imported module: https://ghm.test/assets/Repo.js",
  "Importing a module script failed.",
  "error loading dynamically imported module",
])("treats %s as a chunk load failure", (message) => {
  expect(isChunkLoadError(new TypeError(message))).toBe(true);
});

test("other errors are retried in place", () => {
  expect(isChunkLoadError(new TypeError("Cannot read properties of null"))).toBe(false);
  expect(isChunkLoadError({ kind: "network" })).toBe(false);
});
