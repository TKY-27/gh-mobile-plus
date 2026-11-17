import type { Locator, Page } from "@playwright/test";
import enApp from "../../src/i18n/messages/en/app.json" with { type: "json" };
import { expect, type MockOAuth, type MockUserName } from "./github.ts";

export function accountTab(page: Page): Locator {
  return page.locator('[data-tab="account"]');
}

export async function openAccountScreen(page: Page) {
  await accountTab(page).click();
  await expect(page).toHaveURL("/account");
}

export function accountSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: enApp["accounts.title"] });
}

// Wait to avoid dismissing the sheet.
export async function tapInSheet(target: Locator) {
  let previous = "";
  await expect
    .poll(async () => {
      const box = JSON.stringify(await target.boundingBox());
      const settled = box !== "null" && box === previous;
      previous = box;
      return settled;
    })
    .toBe(true);
  await expect(target).toBeInViewport({ ratio: 1 });
  await target.click();
}

export async function addAccount(page: Page, oauth: MockOAuth, user: MockUserName) {
  await oauth.configure({ user });
  await openAccountScreen(page);
  await page.getByRole("button", { name: enApp["accounts.switch"] }).click();
  await tapInSheet(accountSheet(page).getByRole("link", { name: enApp["accounts.add"] }));
  await expect(page).toHaveURL("/");
  await expect(accountTab(page)).toBeVisible();
}
