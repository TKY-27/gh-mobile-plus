import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "./internal/test-doubles";

async function loadPreferences() {
  vi.resetModules();
  return import("./preferences");
}

beforeEach(() => {
  installBrowserDoubles();
});

describe("preferences", () => {
  it("defaults to keeping private content offline", async () => {
    const { readPreferences } = await loadPreferences();
    expect(readPreferences()).toMatchObject({ keepPrivateOffline: true, theme: "system" });
  });

  it("persists patches and ignores invalid stored values", async () => {
    localStorage.setItem(
      "ghm-preferences",
      JSON.stringify({
        theme: "neon",
        softWrap: true,
        appLock: { enabled: "yes", idleMinutes: 15 },
      }),
    );
    const { readPreferences, setPreferences } = await loadPreferences();
    expect(readPreferences()).toMatchObject({
      theme: "system",
      softWrap: true,
      appLock: { enabled: false, credentialId: null, idleMinutes: 15 },
    });
    setPreferences({ keepPrivateOffline: false });
    expect(JSON.parse(localStorage.getItem("ghm-preferences") ?? "{}")).toMatchObject({
      keepPrivateOffline: false,
      softWrap: true,
    });
  });

  it("follows changes made in another tab", async () => {
    const { readPreferences } = await loadPreferences();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "ghm-preferences", newValue: '{"theme":"dark"}' }),
    );
    expect(readPreferences().theme).toBe("dark");
  });
});
