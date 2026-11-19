import { http, HttpResponse } from "msw";
import {
  accountSheet,
  addAccount,
  openAccountScreen,
  tapInSheet,
  waitForSheetControl,
} from "./support/accounts.ts";
import { dumpIndexedDb } from "./support/storage.ts";
import { API_ORIGIN, expect, githubGraphql, signIn, test } from "./support/github.ts";

test("profile editing requests consent, retries rejected changes and updates Account and Home", async ({
  page,
  github,
  oauth,
}) => {
  const profile = {
    name: "Mona Octocat",
    bio: "Building mobile tools",
    company: "Octo",
    location: "Tokyo",
    blog: "",
  };
  const patches: unknown[] = [];
  const editors: (number | null)[] = [];
  github.use(
    http.get(`${API_ORIGIN}/user`, async () => {
      const authorizations = (await oauth.report()).authorizations;
      const scope = authorizations.at(-1)?.scope ?? "";
      return HttpResponse.json(profile, {
        headers: { "X-OAuth-Scopes": scope.replaceAll(" ", ", ") },
      });
    }),
    http.patch(`${API_ORIGIN}/user`, async ({ request }) => {
      const bearer = request.headers.get("Authorization")?.slice("Bearer ".length) ?? "";
      editors.push((await oauth.introspect(bearer)).userId);
      patches.push(await request.json());
      if (patches.length === 1) {
        return HttpResponse.json(
          { message: "Validation failed", errors: [{ field: "name" }] },
          { status: 422 },
        );
      }
      return HttpResponse.json({ ...profile, name: "Mona Updated", location: null });
    }),
  );

  await signIn(page, oauth);
  await addAccount(page, oauth, "hubot");
  await oauth.configure({ user: "mona" });
  await openAccountScreen(page);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  const peer = await page.context().newPage();
  await peer.goto("/account");
  await peer.getByRole("button", { name: "Switch account" }).click();
  await tapInSheet(accountSheet(peer).getByRole("button", { name: "hubot" }));
  await expect
    .poll(() => peer.evaluate(() => localStorage.getItem("ghm-active-account")))
    .toBe("1002");
  await peer.close();
  await tapInSheet(editor.getByRole("link", { name: "Authorize on GitHub" }));

  await expect(page).toHaveURL("/account?editProfile=1001");
  expect((await oauth.report()).authorizations.at(-1)).toMatchObject({
    scope: "repo notifications workflow read:org user",
    login: "mona",
  });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toHaveValue("Mona Octocat");
  const save = editor.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await name.fill("First name attempt");
  await expect(save).toBeInViewport({ ratio: 1 });
  await editor.getByRole("textbox", { name: "Location" }).clear();
  await editor.getByRole("textbox", { name: "Website" }).fill("mona.example");
  await save.click();
  await expect(editor.getByRole("alert")).toContainText("GitHub rejected");
  await expect(name).toHaveValue("First name attempt");
  await name.fill("Mona Updated");
  await save.click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL("/account");
  await expect(page.getByText("Mona Updated", { exact: true })).toBeVisible();
  expect(editors).toEqual([1001, 1001]);
  expect(patches).toEqual([
    { name: "First name attempt", location: "", blog: "https://mona.example/" },
    { name: "Mona Updated", location: "", blog: "https://mona.example/" },
  ]);
  await page.locator('[data-tab="home"]').click();
  await expect(page.getByRole("link", { name: /Mona Updated/ })).toBeVisible();
});

test("social links can be added and removed without submitting profile edits", async ({
  page,
  github,
  oauth,
}) => {
  const link = "https://social.example/@mona";
  let published = false;
  const writes: unknown[] = [];
  github.use(
    http.get(`${API_ORIGIN}/user`, () =>
      HttpResponse.json(
        {
          name: "Mona Octocat",
          bio: null,
          company: null,
          location: null,
          blog: "",
          twitter_username: null,
          email: null,
          hireable: false,
        },
        { headers: { "X-OAuth-Scopes": "user, repo" } },
      ),
    ),
    http.get(`${API_ORIGIN}/user/social_accounts`, () =>
      HttpResponse.json(published ? [{ provider: "generic", url: link }] : []),
    ),
    http.post(`${API_ORIGIN}/user/social_accounts`, async ({ request }) => {
      writes.push(await request.json());
      published = true;
      return HttpResponse.json([{ provider: "generic", url: link }], { status: 201 });
    }),
    http.delete(`${API_ORIGIN}/user/social_accounts`, async ({ request }) => {
      writes.push(await request.json());
      published = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await signIn(page, oauth);
  await openAccountScreen(page);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  await waitForSheetControl(editor.getByRole("button", { name: "Close", exact: true }));
  await editor.getByText("Social links", { exact: true }).click();
  await editor.getByRole("textbox", { name: "Social profile URL" }).fill(link);
  await editor.getByRole("button", { name: "Add link" }).click();
  await expect(editor.getByText(link, { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: `Remove ${link}` }).click();
  await expect(editor.getByText(link, { exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ account_urls: [link] }, { account_urls: [link] }]);
  expect(
    github.requests.some(({ method, url }) => method === "PATCH" && url === `${API_ORIGIN}/user`),
  ).toBe(false);
});

test("an absent return account does not open another editor", async ({ page, oauth, github }) => {
  await signIn(page, oauth);
  await page.goto("/account?editProfile=1002");
  await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit profile" })).toHaveCount(0);
  expect(github.requests.some(({ url }) => url === `${API_ORIGIN}/user`)).toBe(false);
});

test("scrolling profile fields keeps the sheet open and dragging its header dismisses it", async ({
  page,
  oauth,
  github,
}) => {
  github.use(
    http.get(`${API_ORIGIN}/user`, () =>
      HttpResponse.json({ name: "Mona" }, { headers: { "X-OAuth-Scopes": "user" } }),
    ),
  );
  await signIn(page, oauth);
  await openAccountScreen(page);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Unsaved change");
  const email = editor.getByRole("textbox", { name: "Public email" });
  await email.scrollIntoViewIfNeeded();
  await expect(email).toBeInViewport();
  await name.scrollIntoViewIfNeeded();
  await expect(name).toHaveValue("Unsaved change");
  const title = await editor.getByRole("heading", { name: "Edit profile" }).boundingBox();
  if (!title) throw new Error("Missing sheet header");
  const x = title.x + title.width / 2;
  const y = title.y + title.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 6 });
  await page.mouse.up();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL("/account");
});

test("a refetch error keeps profile edits and closing during save keeps the editor out of storage", async ({
  page,
  oauth,
  github,
}) => {
  let releaseSave: (() => void) | undefined;
  const saveResponse = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const profile = { name: "Mona", email: "editor-only@example.test" };
  let failReads = false;
  github.use(
    http.get(`${API_ORIGIN}/user`, () =>
      failReads
        ? HttpResponse.json({ message: "Forbidden" }, { status: 403 })
        : HttpResponse.json(profile, { headers: { "X-OAuth-Scopes": "user, repo" } }),
    ),
    http.patch(`${API_ORIGIN}/user`, async () => {
      await saveResponse;
      return HttpResponse.json({ ...profile, name: "Saved after dismissal" });
    }),
  );
  await signIn(page, oauth);
  await openAccountScreen(page);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Saved after dismissal");
  failReads = true;
  let profileRefetches = 0;
  github.use(
    githubGraphql.query("Profile", () => {
      profileRefetches++;
      return HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 });
    }),
  );
  await page.clock.setFixedTime(new Date(Date.now() + 120_000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
  );
  await expect(editor.getByRole("alert")).toContainText("permission");
  await expect.poll(() => profileRefetches).toBeGreaterThan(0);
  await expect(name).toHaveValue("Saved after dismissal");
  try {
    await Promise.all([
      page.waitForRequest(
        (request) => request.method() === "PATCH" && request.url() === `${API_ORIGIN}/user`,
      ),
      editor.getByRole("button", { name: "Save changes" }).click(),
    ]);
    await tapInSheet(editor.getByRole("button", { name: "Close", exact: true }));
    await expect(editor).toBeHidden();
  } finally {
    releaseSave?.();
  }
  let persisted = "";
  await expect
    .poll(async () => {
      persisted = JSON.stringify(await dumpIndexedDb(page));
      return persisted.includes("Saved after dismissal");
    })
    .toBe(true);
  expect(persisted).not.toContain(profile.email);
});

test("an editor reopened during a save receives the saved fields", async ({
  page,
  oauth,
  github,
}) => {
  let releaseSave: (() => void) | undefined;
  const commit = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  github.use(
    http.get(`${API_ORIGIN}/user`, () =>
      HttpResponse.json({ name: "Before" }, { headers: { "X-OAuth-Scopes": "user" } }),
    ),
    http.patch(`${API_ORIGIN}/user`, async () => {
      await commit;
      return HttpResponse.json({ name: "After" });
    }),
  );
  await signIn(page, oauth);
  await openAccountScreen(page);
  const trigger = page.getByRole("button", { name: "Edit profile", exact: true });
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await trigger.click();
  await name.fill("After");
  try {
    await Promise.all([
      page.waitForRequest(
        (request) => request.method() === "PATCH" && request.url() === `${API_ORIGIN}/user`,
      ),
      editor.getByRole("button", { name: "Save changes" }).click(),
    ]);
    await tapInSheet(editor.getByRole("button", { name: "Close", exact: true }));
    await trigger.click();
    await expect(name).toHaveValue("Before");
  } finally {
    releaseSave?.();
  }
  await expect(name).toHaveValue("After");
});
