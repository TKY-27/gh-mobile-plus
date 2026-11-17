import { describe, expect, it } from "vitest";
import { themedColor } from "./ansi.ts";

describe("themedColor", () => {
  it("keeps colors the parser already themed", () => {
    expect(themedColor("var(--ghm-ansi-1, #cd3131)")).toBe("var(--ghm-ansi-1, #cd3131)");
  });

  it("snaps extended colors to the nearest themed hue", () => {
    expect(themedColor("#ff0000")).toBe("var(--ghm-ansi-1)");
    expect(themedColor("#00ff00")).toBe("var(--ghm-ansi-2)");
    expect(themedColor("#0000ff")).toBe("var(--ghm-ansi-4)");
    expect(themedColor("#00ffff")).toBe("var(--ghm-ansi-6)");
    expect(themedColor("#ffd700")).toBe("var(--ghm-ansi-3)");
  });

  it("maps grays by lightness", () => {
    expect(themedColor("#282c34")).toBe("var(--ghm-ansi-0)");
    expect(themedColor("#808080")).toBe("var(--ghm-ansi-8)");
    expect(themedColor("#eeeeee")).toBe("var(--ghm-ansi-7)");
  });
});
