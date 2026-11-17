import { describe, expect, it } from "vitest";
import { createTranslator, loadMessages } from "@/i18n/index.tsx";
import { lineLocation, lineSpan } from "./location.ts";

describe("line locations", () => {
  it("treats a missing or equal start as one line", () => {
    expect(lineSpan(undefined, 12)).toBe("12");
    expect(lineSpan(null, 12)).toBe("12");
    expect(lineSpan(12, 12)).toBe("12");
    expect(lineSpan(9, 12)).toBe("9–12");
  });

  it("localizes single lines and ranges", async () => {
    const t = createTranslator("en", await loadMessages("en"));
    expect(lineLocation(t, null, 4)).toBe("Line 4");
    expect(lineLocation(t, 2, 4)).toBe("Lines 2–4");
  });
});
