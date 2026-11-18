import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, test } from "vitest";
import { createNavigator, homeTabFor } from "./navigator.ts";

function start(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const navigator = createNavigator(history, { animatePopsFromHistory: true });
  const paths = (tab = navigator.getState().activeTab) =>
    navigator.getState().stacks[tab].map((entry) => entry.href);
  return { history, navigator, paths };
}

describe("navigator", () => {
  test("keeps an independent stack per tab", () => {
    const { history, navigator, paths } = start("/");
    history.push("/octo/repo");
    history.push("/octo/repo/pull/1");
    navigator.selectTab("repositories");
    expect(history.location.pathname).toBe("/repositories");
    history.push("/octo/repo/issues/2");
    navigator.selectTab("home");
    expect(history.location.pathname).toBe("/octo/repo/pull/1");
    expect(paths("home")).toEqual(["/", "/octo/repo", "/octo/repo/pull/1"]);
    expect(paths("repositories")).toEqual(["/repositories", "/octo/repo/issues/2"]);
  });

  test("history back pops the active stack and animates the leaving screen", () => {
    const { history, navigator, paths } = start("/");
    history.push("/octo/repo");
    history.push("/octo/repo/pulls");
    const leavingKey = navigator.getState().stacks.home.at(-1)?.key;
    history.back();
    expect(paths()).toEqual(["/", "/octo/repo"]);
    expect(navigator.getState().leaving?.entry.key).toBe(leavingKey);
    navigator.finishLeaving(leavingKey ?? "");
    expect(navigator.getState().leaving).toBeNull();
  });

  test("in-app back without animation leaves nothing to animate", () => {
    const { history, navigator, paths } = start("/");
    history.push("/octo");
    navigator.back({ animated: false });
    expect(paths()).toEqual(["/"]);
    expect(history.location.pathname).toBe("/");
    expect(navigator.getState().leaving).toBeNull();
  });

  test("back at another tab's root returns to Home", () => {
    const { history, navigator } = start("/");
    history.push("/octo");
    navigator.selectTab("work");
    history.back();
    expect(navigator.getState().activeTab).toBe("home");
    expect(history.location.pathname).toBe("/octo");
  });

  test("pop to root walks back through history", () => {
    const { history, navigator, paths } = start("/pulls");
    history.push("/octo/repo");
    history.push("/octo/repo/pull/3");
    navigator.popToRoot();
    expect(paths()).toEqual(["/pulls"]);
    expect(history.location.pathname).toBe("/pulls");
  });

  test("replace updates the top screen without remounting it", () => {
    const { history, navigator } = start("/repositories");
    const key = navigator.getState().stacks.repositories[0]?.key;
    history.replace("/repositories?sort=updated");
    expect(navigator.getState().stacks.repositories).toEqual([
      { key, href: "/repositories?sort=updated", pathname: "/repositories" },
    ]);
  });

  test("a cold deep link opens on top of the fitting tab root", () => {
    const { history, navigator, paths } = start("/octo/repo/pull/7");
    expect(navigator.getState().activeTab).toBe("home");
    expect(paths()).toEqual(["/", "/octo/repo/pull/7"]);
    history.back();
    expect(paths()).toEqual(["/"]);
    expect(history.location.pathname).toBe("/");
  });

  test("only tabs the user has opened are mounted", () => {
    const { navigator } = start("/");
    expect(navigator.getState().visited).toEqual(["home"]);
    navigator.selectTab("repositories");
    navigator.selectTab("home");
    expect(navigator.getState().visited).toEqual(["home", "repositories"]);
  });

  test("a cold deep link mounts only its own tab", () => {
    const { navigator } = start("/repositories");
    expect(navigator.getState().visited).toEqual(["repositories"]);
  });

  test.each([
    ["/repositories", "repositories"],
    ["/notifications", "home"],
    ["/pulls", "work"],
    ["/settings/accounts", "account"],
    ["/octo/repo", "home"],
  ])("%s belongs to the %s tab", (path, tab) => {
    expect(homeTabFor(path)).toBe(tab);
  });
});
