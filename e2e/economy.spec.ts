import { expect, signIn, test } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

const MAX_COLD_OPEN_REQUESTS = 6;

test("cold opens of Home, Work and Inbox cost at most six requests", async ({
  page,
  oauth,
  github,
}) => {
  await signIn(page, oauth);
  await expect(page.locator('[data-stack-screen="/"]').getByText("Mona Lisa")).toBeVisible();
  await openInApp(page, "/pulls");
  await expect(page.getByText("Improve mobile review").first()).toBeVisible();
  await openInApp(page, "/notifications");
  await expect(
    page
      .locator('[data-stack-screen="/notifications"] li')
      .filter({ hasText: "Fix offline state" }),
  ).toBeVisible();
  const forwarded = github.requests
    .filter((request) => request.outcome === "forwarded")
    .map((request) => `${request.method} ${new URL(request.url).pathname}`);
  expect(forwarded.length, forwarded.join("\n")).toBeLessThanOrEqual(MAX_COLD_OPEN_REQUESTS);
});
