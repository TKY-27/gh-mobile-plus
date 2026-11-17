import { describe, expect, test } from "vitest";
import { createTranslator, loadMessages, resolveLanguage } from "./index.tsx";

describe("resolveLanguage", () => {
  test("an explicit preference wins over the system", () => {
    expect(resolveLanguage("ja", ["en-US"])).toBe("ja");
  });
  test("picks the first supported system language", () => {
    expect(resolveLanguage("system", ["fr-FR", "ja-JP", "en"])).toBe("ja");
  });
  test("falls back to English", () => {
    expect(resolveLanguage("system", ["de-DE"])).toBe("en");
  });
});

describe("translator", () => {
  test("selects the plural form and formats numbers", async () => {
    const t = createTranslator("en", await loadMessages("en"));
    expect(t("app.lock.failed", { count: 1 })).toBe("Unlock failed 1 time. Try again.");
    expect(t("app.lock.failed", { count: 1200 })).toBe("Unlock failed 1,200 times. Try again.");
  });
  test("interpolates string parameters", async () => {
    const t = createTranslator("ja", await loadMessages("ja"));
    expect(t("errors.orgAccessRestricted.title", { org: "acme" })).toBe(
      "acme はサードパーティアプリを制限しています",
    );
  });
  test("fails loudly on a missing parameter", async () => {
    const t = createTranslator("en", await loadMessages("en"));
    expect(() => t("errors.orgAccessRestricted.title", {})).toThrow('Missing parameter "org"');
  });
  test("ships the same keys in both languages", async () => {
    const [en, ja] = await Promise.all([loadMessages("en"), loadMessages("ja")]);
    expect([...ja.keys()].sort()).toEqual([...en.keys()].sort());
  });
});
