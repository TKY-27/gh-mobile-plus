import { describe, expect, it } from "vitest";
import { labelColors } from "./label-color.ts";

describe("labelColors", () => {
  it("uses white text on dark labels and black on light ones", () => {
    expect(labelColors("5319e7")).toEqual({ background: "#5319e7", text: "#ffffff" });
    expect(labelColors("a2eeef")).toEqual({ background: "#a2eeef", text: "#000000" });
  });

  it("falls back to a neutral chip for malformed colors", () => {
    expect(labelColors("red")).toEqual({ background: "#ededed", text: "#000000" });
  });
});
