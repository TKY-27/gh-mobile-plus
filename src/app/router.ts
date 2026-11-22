import { lazy } from "react";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppRoot } from "./AppRoot.tsx";
import { createNavigator } from "./navigation/navigator.ts";
import { isIOSBrowserTab } from "./platform.ts";

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function parseNumber(raw: string): number | false {
  return POSITIVE_INTEGER.test(raw) ? Number(raw) : false;
}

export const rootRoute = createRootRoute({ component: AppRoot });

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazy(() => import("@/features/home/HomeScreen.tsx")),
});
export const starredReleasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard/releases",
  component: lazy(() => import("@/features/home/StarredReleasesScreen.tsx")),
});
export const newRepoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "new",
  component: lazy(() => import("@/features/repo/RepositoryCreateScreen.tsx")),
});
export const repositoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "repositories",
  component: lazy(() =>
    import("@/features/account/profile/ProfileScreen.tsx").then((module) => ({
      default: module.MyRepositoriesScreen,
    })),
  ),
});
export const workRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "pulls",
  component: lazy(() => import("@/features/work/WorkScreen.tsx")),
});
export const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "notifications",
  component: lazy(() => import("@/features/inbox/InboxScreen.tsx")),
});
export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "search",
  component: lazy(() => import("@/features/search/SearchScreen.tsx")),
});
export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "account",
  component: lazy(() => import("@/features/account/AccountScreen.tsx")),
});
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: lazy(() => import("@/features/settings/SettingsScreen.tsx")),
});
export const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/$section",
  component: lazy(() => import("@/features/settings/SettingsSectionScreen.tsx")),
});
export const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: "signin" });
export const welcomeRoute = createRoute({ getParentRoute: () => rootRoute, path: "welcome" });

export const ownerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner",
  component: lazy(() => import("@/features/account/profile/ProfileScreen.tsx")),
});
export const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo",
  component: lazy(() => import("@/features/repo/RepoScreen.tsx")),
});
export const forkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/fork",
  component: lazy(() => import("@/features/repo/RepositoryForkScreen.tsx")),
});
export const repoSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/settings",
  component: lazy(() => import("@/features/repo/RepositorySettingsScreen.tsx")),
});
export const treeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/tree/$ref/$",
  component: lazy(() => import("@/features/code/TreeScreen.tsx")),
});
export const blobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/blob/$ref/$",
  component: lazy(() => import("@/features/code/FileScreen.tsx")),
});
export const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/edit/$ref/$",
  component: lazy(() => import("@/features/code/EditScreen.tsx")),
});
export const newFileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/new/$ref/$",
  component: lazy(() => import("@/features/code/CreateFileScreen.tsx")),
});
export const issuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/issues",
  component: lazy(() => import("@/features/repo/IssueListScreen.tsx")),
});
export const newIssueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/issues/new",
  component: lazy(() => import("@/features/issue/NewIssueScreen.tsx")),
});
export const issueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/issues/$number",
  params: {
    parse: ({ owner, repo, number }) => {
      const parsed = parseNumber(number);
      return parsed === false ? false : { owner, repo, number: parsed };
    },
    stringify: (params) => ({ ...params, number: String(params.number) }),
  },
  component: lazy(() => import("@/features/issue/IssueScreen.tsx")),
});
export const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/compare",
  component: lazy(() => import("@/features/pull/NewPullScreen.tsx")),
});
export const pullsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/pulls",
  component: lazy(() => import("@/features/repo/PullListScreen.tsx")),
});
export const pullRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/pull/$number",
  params: {
    parse: ({ owner, repo, number }) => {
      const parsed = parseNumber(number);
      return parsed === false ? false : { owner, repo, number: parsed };
    },
    stringify: (params) => ({ ...params, number: String(params.number) }),
  },
  component: lazy(() => import("@/features/pull/PullScreen.tsx")),
});
export const pullFilesRoute = createRoute({
  getParentRoute: () => pullRoute,
  path: "files",
  component: lazy(() => import("@/features/review/ReviewScreen.tsx")),
});
export const pullChecksRoute = createRoute({
  getParentRoute: () => pullRoute,
  path: "checks",
  component: lazy(() => import("@/features/pull/ChecksScreen.tsx")),
});
export const pullCommitsRoute = createRoute({
  getParentRoute: () => pullRoute,
  path: "commits",
  component: lazy(() => import("@/features/pull/CommitsScreen.tsx")),
});
export const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/actions",
  component: lazy(() => import("@/features/actions/RunsScreen.tsx")),
});
export const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/actions/runs/$runId",
  params: {
    parse: ({ owner, repo, runId }) => {
      const parsed = parseNumber(runId);
      return parsed === false ? false : { owner, repo, runId: parsed };
    },
    stringify: (params) => ({ ...params, runId: String(params.runId) }),
  },
  component: lazy(() => import("@/features/actions/RunScreen.tsx")),
});
export const jobRoute = createRoute({
  getParentRoute: () => runRoute,
  path: "job/$jobId",
  params: {
    parse: ({ jobId }) => {
      const parsed = parseNumber(jobId);
      return parsed === false ? false : { jobId: parsed };
    },
    stringify: ({ jobId }) => ({ jobId: String(jobId) }),
  },
  component: lazy(() => import("@/features/actions/JobScreen.tsx")),
});
export const releasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/releases",
  component: lazy(() => import("@/features/repo/ReleasesScreen.tsx")),
});
export const releaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/releases/tag/$tag",
  component: lazy(() => import("@/features/repo/ReleaseScreen.tsx")),
});
export const commitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$owner/$repo/commit/$sha",
  component: lazy(() => import("@/features/review/commit/CommitScreen.tsx")),
});

const diagnosticsRoute = import.meta.env.DEV
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: "__diagnostics",
      component: lazy(() => import("@/features/diagnostics/DiagnosticsScreen.tsx")),
    })
  : null;

const routeTree = rootRoute.addChildren([
  homeRoute,
  starredReleasesRoute,
  repositoriesRoute,
  newRepoRoute,
  workRoute,
  inboxRoute,
  searchRoute,
  accountRoute,
  settingsRoute,
  settingsSectionRoute,
  signInRoute,
  welcomeRoute,
  ownerRoute,
  repoRoute,
  repoSettingsRoute,
  forkRoute,
  treeRoute,
  blobRoute,
  editRoute,
  newFileRoute,
  issuesRoute,
  newIssueRoute,
  issueRoute,
  pullsRoute,
  compareRoute,
  pullRoute.addChildren([pullFilesRoute, pullChecksRoute, pullCommitsRoute]),
  actionsRoute,
  runRoute.addChildren([jobRoute]),
  releasesRoute,
  releaseRoute,
  commitRoute,
  ...(diagnosticsRoute ? [diagnosticsRoute] : []),
]);

const history = createBrowserHistory();

// iOS tabs animate their own back.
export const stackNavigator = createNavigator(history, {
  animatePopsFromHistory: !isIOSBrowserTab,
});

export const router = createRouter({ routeTree, history, defaultPreload: "intent" });

const PRIMARY_TAB_LOADERS = [
  () => import("@/features/work/WorkScreen.tsx"),
  () => import("@/features/account/profile/ProfileScreen.tsx"),
  () => import("@/features/search/SearchScreen.tsx"),
  () => import("@/features/account/AccountScreen.tsx"),
];

export function preloadPrimaryTabs(): void {
  for (const load of PRIMARY_TAB_LOADERS) {
    void load().catch(() => undefined);
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
