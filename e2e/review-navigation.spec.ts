import type { CDPSession } from "@playwright/test";
import { expect, signIn, test } from "./support/github.ts";

const FIRST_FILE = "/octo-org/hello-mobile/pull/43/files?file=src%2Fgreeting.ts";
const DRAG_STEPS = 8;

async function dragTouch(
  session: CDPSession,
  y: number,
  fromX: number,
  toX: number,
  end: "touchEnd" | "touchCancel" = "touchEnd",
) {
  const points = (x: number) => [{ id: 1, x, y }];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(fromX),
  });
  for (let step = 1; step <= DRAG_STEPS; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(fromX + ((toX - fromX) * step) / DRAG_STEPS),
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
}

test("repeated file navigation reaches successive diffs", async ({ browserName, page, oauth }) => {
  await signIn(page, oauth);
  await page.goto(FIRST_FILE);
  const changes = page.getByRole("group", { name: "Changes in src/greeting.ts" });
  await expect(changes).toBeVisible();
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    const box = await changes.boundingBox();
    if (!box) throw new Error("Missing diff");
    const y = box.y + 40;
    const right = box.x + box.width * 0.85;
    const left = box.x + box.width * 0.15;
    await dragTouch(session, y, right, left, "touchCancel");
    await expect(page).toHaveURL(FIRST_FILE);
    await dragTouch(session, y, right, left);
    await expect(page).toHaveURL(/i18n\.ts$/);
    await dragTouch(session, y, right, left);
  } else {
    const next = page.getByRole("button", { name: "Next file" });
    await next.tap();
    await expect(page).toHaveURL(/i18n\.ts$/);
    await next.tap();
  }
  await expect(page.getByRole("group", { name: "Changes in src/names.ts" })).toBeInViewport();
});
