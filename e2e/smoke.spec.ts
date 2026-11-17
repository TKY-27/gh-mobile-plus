import { defineNetworkFixture } from "@msw/playwright";
import { expect, test } from "@playwright/test";
import { http, HttpResponse } from "msw";

test("signed-out visitors land on the welcome screen", async ({ page, context }) => {
  const network = defineNetworkFixture({
    context,
    handlers: [
      http.all("https://api.github.com/*", () => HttpResponse.error()),
      http.get("*/auth/accounts", () => HttpResponse.json([])),
    ],
  });
  await network.enable();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to GH Mobile+" })).toBeVisible();
    await expect(page.getByText("Unofficial GitHub client", { exact: true })).toBeVisible();
  } finally {
    await network.disable();
  }
});
