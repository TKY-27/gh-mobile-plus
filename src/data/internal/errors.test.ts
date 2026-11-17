import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorDiagnostics, isGitHubError, orgApprovalUrl, rememberOAuthClientId } from "../errors";
import { HTTP_FORBIDDEN } from "./constants";
import { errorFromGraphQL, errorFromResponse, gitHubFailure } from "./errors";

const NOW = Date.UTC(2026, 10, 17, 12);
const BACKOFF_MS = 60_000;

function map(status: number, body: unknown, headers: Record<string, string> = {}) {
  return errorFromResponse(status, new Headers(headers), body, BACKOFF_MS);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("errorFromResponse", () => {
  it("maps plain statuses", () => {
    expect(map(401, { message: "Bad credentials" })).toEqual({ kind: "authExpired" });
    expect(map(404, { message: "Not Found" })).toEqual({ kind: "notFound" });
    expect(map(410, { message: "Gone" })).toEqual({ kind: "notFound" });
    expect(map(409, { message: "Head moved" })).toEqual({
      kind: "conflict",
      message: "Head moved",
    });
    expect(map(502, "<html>")).toEqual({ kind: "server", status: 502 });
    expect(map(403, { message: "Must have admin rights" })).toEqual({
      kind: "forbidden",
      message: "Must have admin rights",
    });
  });

  it("collects validation fields", () => {
    const body = {
      message: "Validation Failed",
      errors: [{ resource: "Issue", field: "title", code: "missing_field" }, "free text"],
    };
    expect(map(422, body)).toEqual({
      kind: "validation",
      message: "Validation Failed",
      fields: ["title"],
    });
  });

  it("maps SAML restrictions in a GraphQL 403 body", () => {
    const body = {
      errors: [
        { type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement." },
      ],
    };
    expect(map(HTTP_FORBIDDEN, body)).toEqual({ kind: "orgAccessRestricted", org: "" });
  });

  it("maps a GraphQL 403 with an SSO authorization header", () => {
    const ssoUrl = "https://github.com/orgs/octo-org/sso?authorization_request=abc";
    const error = map(
      HTTP_FORBIDDEN,
      { errors: [{ type: "FORBIDDEN", message: "Forbidden" }] },
      { "X-GitHub-SSO": `required; url=${ssoUrl}` },
    );
    expect(error).toEqual({ kind: "orgAccessRestricted", org: "octo-org", ssoUrl });
  });

  it("maps OAuth App restriction messages and names the org", () => {
    const message =
      "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions.";
    expect(map(403, { message })).toEqual({ kind: "orgAccessRestricted", org: "acme" });
  });

  it("ignores SSO URLs outside github.com", () => {
    const error = map(
      403,
      { message: "Forbidden" },
      { "X-GitHub-SSO": "required; url=https://evil.example/orgs/x/sso" },
    );
    expect(error).toEqual({ kind: "forbidden", message: "Forbidden" });
  });

  it("separates primary and secondary rate limits", () => {
    const reset = String(NOW / 1000 + 900);
    expect(
      map(
        403,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": reset,
        },
      ),
    ).toEqual({ kind: "rateLimited", resetAt: new Date(NOW + 900_000), secondary: false });
    expect(map(403, { message: "You have exceeded a secondary rate limit" })).toEqual({
      kind: "rateLimited",
      resetAt: new Date(NOW + BACKOFF_MS),
      secondary: true,
    });
    expect(map(429, { message: "slow down" }, { "retry-after": "30" })).toEqual({
      kind: "rateLimited",
      resetAt: new Date(NOW + 30_000),
      secondary: true,
    });
  });
});

describe("errorFromGraphQL", () => {
  const headers = new Headers();
  it("maps typed GraphQL errors", () => {
    expect(
      errorFromGraphQL([{ type: "NOT_FOUND", message: "Could not resolve" }], headers, 0),
    ).toEqual({ kind: "notFound" });
    expect(errorFromGraphQL([{ type: "FORBIDDEN", message: "No access" }], headers, 0)).toEqual({
      kind: "forbidden",
      message: "No access",
    });
    expect(
      errorFromGraphQL([{ type: "STALE_DATA", message: "Expected branch" }], headers, 0),
    ).toEqual({ kind: "conflict", message: "Expected branch" });
    expect(errorFromGraphQL([{ type: "INTERNAL", message: "boom" }], headers, 0)).toEqual({
      kind: "server",
      status: 500,
    });
    expect(errorFromGraphQL([{ message: "Field 'x' doesn't exist" }], headers, 0)).toEqual({
      kind: "validation",
      message: "Field 'x' doesn't exist",
      fields: [],
    });
  });

  it("maps SAML and rate-limit errors", () => {
    const saml = "Resource protected by organization SAML enforcement.";
    expect(errorFromGraphQL([{ type: "FORBIDDEN", message: saml }], headers, 0)).toEqual({
      kind: "orgAccessRestricted",
      org: "",
    });
    const limited = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(NOW / 1000 + 60),
    });
    expect(
      errorFromGraphQL([{ type: "RATE_LIMITED", message: "API rate limit" }], limited, 0),
    ).toEqual({
      kind: "rateLimited",
      resetAt: new Date(NOW + 60_000),
      secondary: false,
    });
  });
});

describe("public error helpers", () => {
  it("recognizes thrown failures as GitHubError values", () => {
    const failure = gitHubFailure({ kind: "server", status: 503 });
    expect(failure).toBeInstanceOf(Error);
    expect(isGitHubError(failure)).toBe(true);
    expect(isGitHubError(new Error("x"))).toBe(false);
    expect(isGitHubError({ kind: "other" })).toBe(false);
  });

  it("builds the approval URL from the relay's client id", () => {
    rememberOAuthClientId("Iv1.abc");
    expect(orgApprovalUrl()).toBe("https://github.com/settings/connections/applications/Iv1.abc");
    rememberOAuthClientId(null);
    expect(orgApprovalUrl()).toBe("https://github.com/settings/applications");
  });

  it("writes diagnostics without the SSO authorization URL", () => {
    const text = errorDiagnostics(
      gitHubFailure({
        kind: "orgAccessRestricted",
        org: "acme",
        ssoUrl: "https://github.com/orgs/acme/sso?authorization_request=secret",
      }),
    );
    expect(text).toContain("kind=orgAccessRestricted");
    expect(text).toContain("org=acme");
    expect(text).not.toContain("authorization_request");
    const unknown = errorDiagnostics(new TypeError("repo acme/secret-plans failed"));
    expect(unknown).toContain("error=TypeError");
    expect(unknown).not.toContain("secret-plans");
  });
});
