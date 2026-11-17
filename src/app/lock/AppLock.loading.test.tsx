import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { setPreferences } from "@/data/preferences";
import { moduleClass } from "@/ui/module-class.ts";
import { AppLock } from "./AppLock.tsx";
import styles from "./AppLock.module.css";

const lockScreenModule = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
});

vi.mock("./LockScreen.tsx", async (importOriginal) => {
  await lockScreenModule.pending;
  return importOriginal();
});

afterEach(async () => {
  cleanup();
  lockScreenModule.release();
  await vi.dynamicImportSettled();
  vi.unstubAllGlobals();
});

test("the privacy cover hides app content while the lock screen loads", () => {
  vi.stubGlobal("localStorage", window.sessionStorage);
  setPreferences({ appLock: { enabled: true, credentialId: "credential", idleMinutes: 1 } });
  const { container } = render(
    <AppLock>
      <button>Private content</button>
    </AppLock>,
  );

  const cover = container.querySelector(`.${moduleClass(styles.lock)}[aria-hidden="true"]`);
  expect(cover).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
  const privateContent = screen.queryByText("Private content");
  expect(
    privateContent === null || privateContent.closest('[style*="display: none"]'),
  ).toBeTruthy();
});
