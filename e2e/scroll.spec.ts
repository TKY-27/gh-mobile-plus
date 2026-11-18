import { HttpResponse } from "msw";
import repositories from "../src/data/users/fixtures/repositories.json" with { type: "json" };
import { expect, githubGraphql, signIn, test } from "./support/github.ts";
import { inScreen } from "./support/screens.ts";

const PROFILE_REPOS = "/mona?tab=repositories";
const PAGE_SIZE = 50;

test("a scrolled repository list restores its visible rows after Back and a tab switch", async ({
  github,
  oauth,
  page,
}) => {
  const sample = repositories.data.repositoryOwner.repositories.nodes[0];
  if (!sample) throw new Error("Missing repository fixture");
  const nodes = Array.from({ length: PAGE_SIZE }, (_, index) => ({
    ...sample,
    name: `project-${String(index)}`,
    description: index % 2 === 0 ? sample.description.repeat(4) : null,
  }));
  github.use(
    githubGraphql.query("RepositoriesOf", () =>
      HttpResponse.json({
        data: {
          repositoryOwner: {
            __typename: "User",
            repositories: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    ),
  );
  await signIn(page, oauth);
  await page.goto(PROFILE_REPOS);
  const list = inScreen(page, PROFILE_REPOS);
  await expect(list.getByRole("link", { name: /project-0\b/ })).toBeVisible();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  const centerRow = () =>
    list.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return hit?.closest("a")?.getAttribute("href") ?? null;
    });
  await expect.poll(centerRow).toMatch(/^\/octo-org\/project-[1-9]\d$/);
  const href = await centerRow();
  if (!href) throw new Error("No repository at viewport center");
  const scrollY = await list.evaluate((element) => element.scrollTop);
  await list.locator(`a[href="${href}"]`).click();
  await expect(page).toHaveURL(href);
  await inScreen(page, href).getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(PROFILE_REPOS);
  await expect.poll(centerRow).toBe(href);
  await page.locator('[data-tab="work"]').click();
  await expect(page).toHaveURL("/pulls");
  await page.locator('[data-tab="home"]').click();
  await expect(page).toHaveURL(PROFILE_REPOS);
  await expect.poll(centerRow).toBe(href);
  expect(await list.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollY, 0);
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(list.getByRole("link", { name: /project-0\b/ })).toBeInViewport();
});
