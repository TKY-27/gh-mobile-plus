import { http, HttpResponse, type RequestHandler } from "msw";
import { graphql } from "msw/graphql";
import runs from "../../src/data/actions/fixtures/runs.json" with { type: "json" };
import workflows from "../../src/data/actions/fixtures/workflows.json" with { type: "json" };
import homeEvents from "../../src/data/home/fixtures/events.json" with { type: "json" };
import homeReleases from "../../src/data/home/fixtures/releases.json" with { type: "json" };
import homeViewer from "../../src/data/home/fixtures/viewer.json" with { type: "json" };
import inboxNotifications from "../../src/data/inbox/fixtures/notifications.json" with { type: "json" };
import issue from "../../src/data/issues/fixtures/issue.json" with { type: "json" };
import timelinePage from "../../src/data/issues/fixtures/issue-timeline-page-2.json" with { type: "json" };
import pullRequest from "../../src/data/pulls/fixtures/pull-request.json" with { type: "json" };
import file from "../../src/data/repo/fixtures/file.json" with { type: "json" };
import readme from "../../src/data/repo/fixtures/readme.json" with { type: "json" };
import refs from "../../src/data/repo/fixtures/refs.json" with { type: "json" };
import repository from "../../src/data/repo/fixtures/repository.json" with { type: "json" };
import tree from "../../src/data/repo/fixtures/tree.json" with { type: "json" };
import pullFiles from "../../src/data/review/fixtures/pull-files.json" with { type: "json" };
import pullFilesViewed from "../../src/data/review/fixtures/pull-files-viewed.json" with { type: "json" };
import reviewThreads from "../../src/data/review/fixtures/review-threads.json" with { type: "json" };
import organizations from "../../src/data/users/fixtures/organizations.json" with { type: "json" };
import profile from "../../src/data/users/fixtures/profile.json" with { type: "json" };
import workQueue from "../../src/data/work/fixtures/queue.json" with { type: "json" };

export const API_ORIGIN = "https://api.github.com";
export const githubGraphql = graphql.link(`${API_ORIGIN}/graphql`);
export const README_HTML =
  '<article class="markdown-body"><h1>Hello Mobile</h1><p>Readme body.</p></article>';
export const GITHUB_HTML_MEDIA_TYPE = "application/vnd.github.html+json";

const HELLO_MOBILE = `${API_ORIGIN}/repos/octo-org/hello-mobile`;
const PULL_NUMBER = pullRequest.data.repository.issueOrPullRequest.number;
const { baseRefOid, headRefOid } = pullFilesViewed.data.repository.pullRequest;
const HTTP_NOT_FOUND = 404;

const notFound = () => HttpResponse.json({ message: "Not Found" }, { status: HTTP_NOT_FOUND });

export const defaultGitHubHandlers: RequestHandler[] = [
  githubGraphql.query("ViewerSummary", () => HttpResponse.json({ data: homeViewer })),
  githubGraphql.query("StarredReleases", () => HttpResponse.json({ data: homeReleases })),
  githubGraphql.query("WorkQueue", () => HttpResponse.json({ data: workQueue })),
  http.get(`${API_ORIGIN}/users/:login/received_events`, () => HttpResponse.json(homeEvents)),
  http.get(`${API_ORIGIN}/notifications`, () => HttpResponse.json(inboxNotifications)),
  githubGraphql.query("ViewerOrganizations", () => HttpResponse.json(organizations)),
  githubGraphql.query("Profile", () => HttpResponse.json(profile)),
  githubGraphql.query("Repository", () => HttpResponse.json(repository)),
  githubGraphql.query("RepositoryRefs", () => HttpResponse.json(refs)),
  githubGraphql.query("RepositoryTree", () => HttpResponse.json(tree)),
  githubGraphql.query("RepositoryFile", () => HttpResponse.json(file)),
  http.get(`${HELLO_MOBILE}/readme`, ({ request }) =>
    request.headers.get("Accept") === GITHUB_HTML_MEDIA_TYPE
      ? HttpResponse.text(README_HTML, { headers: { "Content-Type": GITHUB_HTML_MEDIA_TYPE } })
      : HttpResponse.json(readme),
  ),
  http.get(`${API_ORIGIN}/repos/:owner/:repo/readme`, notFound),
  githubGraphql.query<object, { number: number }>("Conversation", ({ variables }) =>
    HttpResponse.json(variables.number === PULL_NUMBER ? pullRequest : issue),
  ),
  githubGraphql.query("TimelinePage", () => HttpResponse.json(timelinePage)),
  githubGraphql.query("PullFiles", () => HttpResponse.json(pullFilesViewed)),
  githubGraphql.query("ReviewThreads", () => HttpResponse.json(reviewThreads)),
  githubGraphql.query("PendingReview", () =>
    HttpResponse.json({ data: { node: { baseRefOid, headRefOid, reviews: { nodes: [] } } } }),
  ),
  http.get(`${API_ORIGIN}/repos/:owner/:repo/pulls/:number/files`, () =>
    HttpResponse.json(pullFiles),
  ),
  http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/workflows`, () =>
    HttpResponse.json(workflows),
  ),
  http.get(`${API_ORIGIN}/repos/:owner/:repo/actions/runs`, () => HttpResponse.json(runs)),
];
