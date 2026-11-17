import { Suspense, useEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OverflowMenu } from "@/ui/Menu.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { setPreferences } from "@/data/preferences";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { MINUTE_MS } from "@/ui/time.ts";
import { AppLock } from "./AppLock.tsx";
import * as webauthn from "./webauthn.ts";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  class LayoutObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", LayoutObserver);
  vi.stubGlobal("IntersectionObserver", LayoutObserver);
  setPreferences({ appLock: { enabled: true, credentialId: "credential", idleMinutes: 1 } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  webauthn.setSessionVerification(null);
  Reflect.deleteProperty(navigator, "credentials");
});

async function renderLock(children?: ReactNode) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <I18nProvider language="en">
          <AppLock>{children}</AppLock>
        </I18nProvider>
      </Suspense>,
    );
    await loadMessages("en");
  });
}

function ReviewSheet({ onShortcut }: { onShortcut: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "/") onShortcut();
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("keydown", shortcut);
    };
  }, [onShortcut]);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
      >
        Review
      </button>
      <Sheet title="Pending review" isOpen={open} onOpenChange={setOpen}>
        <textarea aria-label="Review summary" />
      </Sheet>
    </>
  );
}

function resumeAfterIdle(whileHidden?: () => void) {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  const hiddenAt = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(hiddenAt);
  visibility.mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  whileHidden?.();
  clock.mockReturnValue(hiddenAt + MINUTE_MS);
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
}

async function enrollLock() {
  class PlatformCredential {
    id = "credential";
  }
  vi.stubGlobal("PublicKeyCredential", PlatformCredential);
  Reflect.defineProperty(navigator, "credentials", {
    configurable: true,
    value: {
      create: vi.fn().mockResolvedValue(new PlatformCredential()),
      get: vi.fn().mockResolvedValue(new PlatformCredential()),
    },
  });
  await webauthn.createLockCredential();
}

test("an idle lock takes focus above an open dialog and preserves its draft", async () => {
  vi.spyOn(webauthn, "wasVerifiedThisSession").mockReturnValue(true);
  vi.spyOn(webauthn, "verifyLockCredential").mockResolvedValue();
  const onShortcut = vi.fn();
  await renderLock(<ReviewSheet onShortcut={onShortcut} />);
  fireEvent.keyDown(window, { key: "/" });
  expect(onShortcut).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const summary = screen.getByRole("textbox", { name: "Review summary" });
  fireEvent.change(summary, { target: { value: "Keep this review" } });
  resumeAfterIdle();

  const lock = await screen.findByRole("dialog", { name: "GH Mobile+ is locked" });
  expect(lock.contains(document.activeElement)).toBe(true);
  expect(screen.queryByRole("textbox", { name: "Review summary" })).toBeNull();
  expect(summary.closest('[inert], [aria-hidden="true"]')).toBeTruthy();
  const unlock = screen.getByRole("button", { name: "Unlock" });
  expect(unlock.closest('[inert], [aria-hidden="true"]')).toBeNull();
  fireEvent.keyDown(window, { key: "/" });
  expect(onShortcut).toHaveBeenCalledOnce();
  fireEvent.keyDown(unlock, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "GH Mobile+ is locked" })).toBe(lock);
  fireEvent.click(unlock);
  expect(await screen.findByDisplayValue("Keep this review")).toBe(summary);
  expect(screen.getByRole("dialog", { name: "Pending review" })).toBeTruthy();
});

test("the open overflow menu cannot paint over the lock", async () => {
  vi.spyOn(webauthn, "wasVerifiedThisSession").mockReturnValue(true);
  await renderLock(<OverflowMenu actions={[{ id: "edit", label: "Edit", onAction: vi.fn() }]} />);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const action = await screen.findByRole("menuitem", { name: "Edit" });
  resumeAfterIdle(() => {
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(action.closest("[hidden]")).toBeTruthy();
  });
  expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
  expect(!action.isConnected || action.closest('[style*="display: none"]')).toBeTruthy();
});

test("only denied WebAuthn prompts count toward the sign-out offer", async () => {
  const securityError = new DOMException("Origin mismatch", "SecurityError");
  const reported = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
  vi.spyOn(webauthn, "verifyLockCredential")
    .mockRejectedValueOnce(securityError)
    .mockRejectedValue(new DOMException("Prompt denied", "NotAllowedError"));
  await renderLock();
  const unlock = await screen.findByRole("button", { name: "Unlock" });
  fireEvent.click(unlock);
  expect(await screen.findByText("Something went wrong")).toBeTruthy();
  expect(reported).toHaveBeenCalledWith(securityError);
  for (const count of [1, 2, 3, 4, 5]) {
    fireEvent.click(unlock);
    await screen.findByText(
      `Unlock failed ${String(count)} ${count === 1 ? "time" : "times"}. Try again.`,
    );
    const signOut = screen.queryByRole("button", { name: "Sign out all accounts" });
    expect(Boolean(signOut)).toBe(count === 5);
  }
  expect(reported).toHaveBeenCalledTimes(1);
});

test("remounting after an idle lock still requires unlocking", async () => {
  await enrollLock();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();

  resumeAfterIdle();
  await screen.findByRole("button", { name: "Unlock" });
  cleanup();
  await renderLock(<button>Private content</button>);

  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Private content" });
  cleanup();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
});

test("a visible unmount expires verification at the idle limit", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
  await enrollLock();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
  clock.mockReturnValue(Date.now() + 2 * MINUTE_MS);
  cleanup();
  clock.mockReturnValue(Date.now() + MINUTE_MS - 1);
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
  cleanup();

  const unmountedAt = Date.now();
  clock.mockReturnValue(unmountedAt + MINUTE_MS);
  await renderLock(<button>Private content</button>);
  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
  cleanup();
  await renderLock(<button>Private content</button>);
  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
});

test("a hidden remount is covered and still locked when it becomes visible", async () => {
  await enrollLock();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
  cleanup();

  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await renderLock(<button>Private content</button>);
  expect(document.body.hidden).toBe(true);

  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  expect(document.body.hidden).toBe(false);
  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
  const lock = await screen.findByRole("dialog", { name: "GH Mobile+ is locked" });
  expect(lock.contains(document.activeElement)).toBe(true);
});

test("an app unmounted while hidden still locks after the idle period", async () => {
  await enrollLock();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();

  resumeAfterIdle(cleanup);
  await renderLock(<button>Private content</button>);
  expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
  expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
});

test("a short resume keeps a continuously mounted app verified", async () => {
  await enrollLock();
  await renderLock(<button>Private content</button>);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();

  cleanup();
  await renderLock(<button>Private content</button>);
  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
});

test.each(["enabled", "replaced"] as const)(
  "a lock %s in another tab requires unlocking",
  async (change) => {
    if (change === "enabled") {
      setPreferences({ appLock: { enabled: false, credentialId: null, idleMinutes: 1 } });
    } else {
      await enrollLock();
    }
    await renderLock(<button>Private content</button>);
    expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();

    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "ghm-preferences",
        newValue: JSON.stringify({
          appLock: { enabled: true, credentialId: "other-credential", idleMinutes: 1 },
        }),
      }),
    );

    expect(screen.queryByRole("button", { name: "Private content" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
  },
);

test("enrolling within the current tab counts as verification", async () => {
  setPreferences({ appLock: { enabled: false, credentialId: null, idleMinutes: 1 } });
  await renderLock(<button>Private content</button>);
  await enrollLock();
  act(() => {
    setPreferences({ appLock: { enabled: true, credentialId: "credential", idleMinutes: 1 } });
  });

  expect(screen.getByRole("button", { name: "Private content" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
});
