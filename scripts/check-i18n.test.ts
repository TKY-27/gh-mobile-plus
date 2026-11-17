import { describe, expect, test } from "vitest";
import { compareCatalogs, compareNamespaces } from "./check-i18n.ts";

describe("catalog parity", () => {
  test("accepts reordered and repeated placeholders", () => {
    expect(
      compareCatalogs({ greeting: "{name}: {count} {name}" }, { greeting: "{count}：{name}" }),
    ).toEqual([]);
  });
  test("reports missing keys in both languages", () => {
    expect(compareCatalogs({ englishOnly: "Hello" }, { japaneseOnly: "こんにちは" })).toEqual([
      'ja: missing key "englishOnly"',
      'en: missing key "japaneseOnly"',
    ]);
  });
  test("rejects empty and whitespace-only translations", () => {
    expect(compareCatalogs({ blank: "", spaces: "ok" }, { blank: "有効", spaces: "  " })).toEqual([
      'en: empty value for "blank"',
      'ja: empty value for "spaces"',
    ]);
  });
  test("rejects different placeholder names", () => {
    expect(compareCatalogs({ greeting: "Hello {name}" }, { greeting: "{login}さん" })).toEqual([
      'Placeholder mismatch for "greeting": en={name} ja={login}',
    ]);
  });
});

describe("namespace parity", () => {
  test("reports a namespace file missing in either language", () => {
    expect(compareNamespaces(["app.json", "inbox.json"], ["app.json", "pull.json"])).toEqual([
      "ja: missing inbox.json",
      "en: missing pull.json",
    ]);
  });
});
