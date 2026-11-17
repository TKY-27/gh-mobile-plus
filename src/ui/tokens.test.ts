import { describe, expect, test } from "vitest";
import tokensCss from "./tokens.css?raw";
import { THEME_COLORS } from "./theme.ts";

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
const MODES = ["light", "dark"] as const;
type Mode = (typeof MODES)[number];

function token(name: string, mode: Mode): string {
  const match = new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`).exec(
    tokensCss,
  );
  const value = mode === "light" ? match?.[1] : match?.[2];
  if (value === undefined) throw new Error(`No opaque light-dark value for --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

const surfaces = ["color-bg", "color-bg-secondary", "color-bg-elevated", "glass-solid-bg"];
const textTokens = [
  "color-text",
  "color-text-secondary",
  "color-text-tertiary",
  "accent-text",
  ...["success", "failure", "pending", "merged", "closed", "draft"].map((s) => `status-${s}`),
];

describe.each(MODES)("%s theme contrast", (mode) => {
  test.each(textTokens.flatMap((text) => surfaces.map((surface) => [text, surface])))(
    "%s on %s meets AA for text",
    (text, surface) => {
      expect(contrast(token(text, mode), token(surface, mode))).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  test("text on the accent fill meets AA", () => {
    expect(contrast(token("on-accent", mode), token("accent-fill", mode))).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  test.each(surfaces)("control borders meet the non-text minimum on %s", (surface) => {
    expect(contrast(token("control-border", mode), token(surface, mode))).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });

  test("accent indicators meet the non-text minimum", () => {
    expect(contrast(token("accent", mode), token("color-bg", mode))).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });

  test("theme-color meta matches the background token", () => {
    expect(THEME_COLORS[mode]).toBe(token("color-bg", mode));
  });
});

test("keeps the specified accent colors", () => {
  expect(token("accent", "light")).toBe("#3d7bff");
  expect(token("accent", "dark")).toBe("#5b8fff");
});
