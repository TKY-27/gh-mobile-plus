import { expect, test, type Page } from "@playwright/test";

const ACCOUNT = { id: 101, login: "octo-dev", avatarUrl: "/icon.svg", publicOnly: false };
const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;
const DETAIL = "/octocat/hello-world";
const SCROLL_OFFSET = 300;
const SLOW_DRAG_STEP_MS = 40;

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ghm-onboarding", "done");
  });
  await page.route("**/auth/accounts", (route) =>
    route.fulfill({
      json: [ACCOUNT],
      headers: { "x-ghm-client-id": "Iv1.e2e" },
    }),
  );
  await page.route("**/auth/token", (route) =>
    route.fulfill({
      json: { accessToken: "e2e-token", expiresAt: Date.now() + TOKEN_LIFETIME_MS },
    }),
  );
  await page.route("https://api.github.com/**", (route) => route.abort());
}

function screen(page: Page, href: string) {
  return page.locator(`[data-stack-screen="${href}"]`);
}

async function makeScrollable(page: Page, href: string) {
  await screen(page, href).evaluate((layer, offset) => {
    const filler = document.createElement("div");
    filler.style.height = "3000px";
    layer.append(filler);
    layer.scrollTop = offset;
  }, SCROLL_OFFSET);
}

async function jumpTo(page: Page, query: string) {
  await page.keyboard.press("/");
  await page.getByRole("dialog").getByRole("searchbox").fill(query);
  await page.getByRole("menuitem", { name: `Open ${query}` }).click();
}

async function swipeFromEdge(page: Page, distanceFraction: number, stepDelayMs = 0) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Viewport is required");
  const y = viewport.height / 2;
  const target = viewport.width * distanceFraction;
  await page.mouse.move(4, y);
  await page.mouse.down();
  for (let x = 16; x <= target; x += 16) {
    await page.mouse.move(x, y);
    if (stepDelayMs) await page.waitForTimeout(stepDelayMs);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("each tab keeps its own stack and scroll position", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await jumpTo(page, "octocat/hello-world");
  await expect(page).toHaveURL(DETAIL);
  await makeScrollable(page, DETAIL);

  await page.getByRole("button", { name: "Inbox" }).click();
  await expect(page).toHaveURL("/notifications");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Home" }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(screen(page, DETAIL)).toBeVisible();
  expect(await screen(page, DETAIL).evaluate((layer) => layer.scrollTop)).toBe(SCROLL_OFFSET);
});

test("re-tapping the active tab scrolls to top, then pops to root", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await jumpTo(page, "octocat/hello-world");
  await expect(page).toHaveURL(DETAIL);
  await makeScrollable(page, DETAIL);

  await page.getByRole("button", { name: "Home" }).click();
  await expect.poll(() => screen(page, DETAIL).evaluate((layer) => layer.scrollTop)).toBe(0);
  await expect(page).toHaveURL(DETAIL);

  await page.getByRole("button", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("a cold deep link opens over its tab root and Back returns to it", async ({ page }) => {
  await page.goto("/octocat/hello-world/pull/7");
  await expect(page.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("browser back pops the active stack", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL("/search");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("octocat/hello-world#42");
  await page.getByRole("menuitem", { name: "Open octocat/hello-world#42" }).click();
  await expect(page).toHaveURL("/octocat/hello-world/issues/42");
  await page.goBack();
  await expect(page).toHaveURL("/search");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
});

test("unvisited tabs stay unmounted and fetch nothing", async ({ page }) => {
  const accountQueries: string[] = [];
  page.on("request", (request) => {
    const body = request.postData() ?? "";
    if (request.url().startsWith("https://api.github.com/") && /Profile|Organizations/.test(body)) {
      accountQueries.push(body);
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(screen(page, "/account")).toHaveCount(0);
  await expect(screen(page, "/pulls")).toHaveCount(0);
  expect(accountQueries).toEqual([]);

  await page.getByRole("button", { name: "Inbox" }).click();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(screen(page, "/notifications")).toHaveCount(1);
  await expect(screen(page, "/account")).toHaveCount(0);
});

test("the account switcher opens from the Account screen and by long press", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("button", { name: "Switch account" }).click();
  await expect(page.getByRole("dialog", { name: "Accounts" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Accounts" })).toHaveCount(0);

  const tab = page
    .getByRole("navigation", { name: "Tabs" })
    .getByRole("button", { name: "Account" });
  const box = await tab.boundingBox();
  if (!box) throw new Error("Account tab is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole("dialog", { name: "Accounts" })).toBeVisible();
  await page.mouse.up();
});

async function focusedScreen(page: Page) {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (focused?.tagName !== "H1") return null;
    return focused.closest("[data-stack-screen]")?.getAttribute("data-stack-screen") ?? null;
  });
}

test("navigation moves focus to the new screen title and back", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await jumpTo(page, "octocat/hello-world");
  await expect.poll(() => focusedScreen(page)).toBe(DETAIL);
  await page.getByRole("button", { name: "Back" }).click();
  await expect.poll(() => focusedScreen(page)).toBe("/");
});

for (const path of [
  "/a/b/c/d",
  "/octocat/hello-world/wiki/Page",
  "/octocat/hello-world/pull/abc",
]) {
  test(`${path} shows Not found instead of a parent screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Not found", level: 2 })).toBeVisible();
  });
}

test.describe("edge swipe", () => {
  // Standalone iOS lacks Safari's back gesture.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if ("standalone" in navigator) {
        Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
      }
    });
  });

  test("a long swipe from the leading edge goes back", async ({ page }) => {
    await page.goto(DETAIL);
    await expect(screen(page, DETAIL)).toBeVisible();
    await swipeFromEdge(page, 0.7);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  });

  test("a short swipe is cancelled and settles back", async ({ page }) => {
    await page.goto(DETAIL);
    await expect(screen(page, DETAIL)).toBeVisible();
    await swipeFromEdge(page, 0.2, SLOW_DRAG_STEP_MS);
    await expect(page).toHaveURL(DETAIL);
    await expect
      .poll(() => screen(page, DETAIL).evaluate((layer) => layer.style.transform))
      .toBe("");
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("still goes back, without animating", async ({ page }) => {
      await page.goto(DETAIL);
      await expect(screen(page, DETAIL)).toBeVisible();
      await swipeFromEdge(page, 0.7);
      await expect(page).toHaveURL("/");
    });
  });
});
