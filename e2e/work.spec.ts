import { HttpResponse } from "msw";
import enWork from "../src/i18n/messages/en/work.json" with { type: "json" };
import workQueue from "../src/data/work/fixtures/queue.json" with { type: "json" };
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { openInApp } from "./support/screens.ts";

const SEGMENTS = [
  { label: enWork["segment.reviewRequested"], count: "70" },
  { label: enWork["segment.myPrs"], count: "1" },
  { label: enWork["segment.assigned"], count: "2" },
  { label: enWork["segment.ciFailing"], count: "1" },
] as const;

test("all four segments load from one GraphQL request", async ({ page, oauth, github }) => {
  let workQueries = 0;
  github.use(
    githubGraphql.query("WorkQueue", () => {
      workQueries += 1;
      return HttpResponse.json({ data: workQueue });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, "/pulls");
  const screen = page.locator('[data-stack-screen^="/pulls"]');
  await expect(screen.getByText("Improve mobile review").first()).toBeVisible();
  for (const segment of SEGMENTS) {
    const button = screen.getByRole("radio", { name: new RegExp(`^${segment.label}`) });
    await expect(button).toContainText(segment.count);
    await button.click();
    await expect(button).toHaveAttribute("aria-checked", "true");
    await expect(screen.getByRole("link").first()).toBeVisible();
  }
  expect(workQueries).toBe(1);
});

test("the refresh action reloads the queue in one request", async ({ page, oauth, github }) => {
  let workQueries = 0;
  github.use(
    githubGraphql.query("WorkQueue", () => {
      workQueries += 1;
      return HttpResponse.json({ data: workQueue });
    }),
  );
  await signIn(page, oauth);
  await openInApp(page, "/pulls");
  const screen = page.locator('[data-stack-screen^="/pulls"]');
  await expect(screen.getByText("Improve mobile review").first()).toBeVisible();
  await screen.getByRole("button", { name: enWork.refresh }).click();
  await expect.poll(() => workQueries).toBe(2);
  await expect(screen.getByRole("button", { name: enWork.refresh })).toBeEnabled();
});
