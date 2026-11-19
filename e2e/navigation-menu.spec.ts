import { http, HttpResponse } from "msw";
import { API_ORIGIN, expect, signIn, test } from "./support/github.ts";

test("navigation menu opens from any tab and returns to its starting screen", async ({
  page,
  oauth,
}) => {
  await signIn(page, oauth);
  await page.locator('[data-tab="work"]').click();
  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer.getByRole("link", { name: "Settings" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL("/pulls");
  await trigger.click();
  await drawer.getByRole("link", { name: "Settings" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL("/settings");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL("/pulls");
});

test("a drawer repository shortcut preserves the source and the repository tab", async ({
  page,
  oauth,
}) => {
  await signIn(page, oauth);
  await page.locator('[data-tab="repositories"]').click();
  await page.getByRole("link", { name: /hello-mobile/ }).click();
  await expect(page).toHaveURL("/mona/hello-mobile");
  await page.locator('[data-tab="work"]').click();
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Repositories" }).click();
  await expect(page).toHaveURL("/mona?tab=repositories");
  await page.goBack();
  await expect(page).toHaveURL("/pulls");
  await page.locator('[data-tab="repositories"]').click();
  await expect(page).toHaveURL("/mona/hello-mobile");
});

test("profile statistics open the corresponding GitHub people list", async ({
  page,
  oauth,
  github,
  context,
}) => {
  github.use(
    http.get(`${API_ORIGIN}/users/mona/followers`, () =>
      HttpResponse.json([{ login: "octo-follower", avatar_url: "/icon.svg" }]),
    ),
    http.get(`${API_ORIGIN}/users/mona/following`, () => HttpResponse.json([])),
  );
  await signIn(page, oauth);
  await page.locator('[data-tab="account"]').click();
  await expect(page.getByRole("button", { name: "Edit profile" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "42 Followers" }).click();
  await expect(page).toHaveURL("/mona?tab=followers");
  await expect(page.getByRole("link", { name: "octo-follower" })).toHaveAttribute(
    "href",
    "/octo-follower",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("link", { name: "7 Following" }).click();
  await expect(page).toHaveURL("/mona?tab=following");
  await expect(page.getByText("Reconnect to see the people on this list.")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "Not following anyone yet" })).toBeVisible();
});

test("swiping just inside the system edge opens the menu in browser tabs", async ({
  page,
  oauth,
}) => {
  await signIn(page, oauth);
  const avatar = page
    .getByRole("list", { name: "Activity" })
    .getByRole("link", { name: "View mona’s profile" })
    .first();
  await expect(avatar).toBeInViewport();
  const bounds = await avatar.boundingBox();
  if (!bounds) throw new Error("The feed avatar must have a hit target");
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(42, y);
  await page.mouse.down();
  await page.mouse.move(180, y + 1, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeInViewport();
});
