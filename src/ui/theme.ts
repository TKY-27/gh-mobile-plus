export type ThemePreference = "system" | "light" | "dark";

export const THEME_COLORS = { light: "#ffffff", dark: "#0f0f11" } as const;

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[theme === "system" ? scheme : theme];
  }
}
