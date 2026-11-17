import type { GitHubError } from "../errors";
import {
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_GONE,
  HTTP_NOT_FOUND,
  HTTP_SERVER_ERROR,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  SECOND_MS,
} from "./constants";
import { property, stringProperty } from "./json";

export type GitHubFailure = GitHubError & Error;

const ORG_RESTRICTION_MESSAGE = /OAuth App access restrictions|SAML/i;
const SECONDARY_LIMIT_MESSAGE = /secondary rate limit/i;
const ORG_IN_MESSAGE = /the `([A-Za-z0-9-]+)` organization/;
const SSO_URL_IN_HEADER = /\burl=(https:\/\/github\.com\/\S+)/;
const ORG_IN_SSO_URL = /^https:\/\/github\.com\/orgs\/([A-Za-z0-9-]+)\/sso/;
const SERVER_SIDE_GRAPHQL_TYPES: ReadonlySet<string> = new Set([
  "INTERNAL",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
]);

// Error instances keep stack traces.
export function gitHubFailure(error: GitHubError): GitHubFailure {
  return Object.assign(new Error(`GitHub ${error.kind}`), error);
}

export async function fetchOrNetworkFailure(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) throw gitHubFailure({ kind: "network" });
    throw error;
  }
}

function orgRestriction(message: string, headers: Headers): GitHubError | null {
  const ssoUrl = SSO_URL_IN_HEADER.exec(headers.get("x-github-sso") ?? "")?.[1];
  if (ssoUrl === undefined && !ORG_RESTRICTION_MESSAGE.test(message)) return null;
  const org = ORG_IN_MESSAGE.exec(message)?.[1] ?? ORG_IN_SSO_URL.exec(ssoUrl ?? "")?.[1] ?? "";
  return ssoUrl === undefined
    ? { kind: "orgAccessRestricted", org }
    : { kind: "orgAccessRestricted", org, ssoUrl };
}

function headerSeconds(headers: Headers, name: string): number | null {
  const value = Number(headers.get(name) ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function isRateLimit(status: number, message: string, headers: Headers): boolean {
  return (
    status === HTTP_TOO_MANY_REQUESTS ||
    SECONDARY_LIMIT_MESSAGE.test(message) ||
    headers.has("retry-after") ||
    headers.get("x-ratelimit-remaining") === "0"
  );
}

function rateLimited(message: string, headers: Headers, backoffMs: number): GitHubError {
  const retryAfter = headerSeconds(headers, "retry-after");
  const reset = headerSeconds(headers, "x-ratelimit-reset");
  const exhausted = headers.get("x-ratelimit-remaining") === "0";
  const secondary = SECONDARY_LIMIT_MESSAGE.test(message) || retryAfter !== null || !exhausted;
  const now = Date.now();
  const resetAt =
    retryAfter !== null
      ? now + retryAfter * SECOND_MS
      : exhausted && reset !== null
        ? reset * SECOND_MS
        : now + backoffMs;
  return { kind: "rateLimited", resetAt: new Date(resetAt), secondary };
}

function validationFields(body: unknown): string[] {
  const errors = property(body, "errors");
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry: unknown) => stringProperty(entry, "field") ?? []);
}

// Sometimes GitHub omits the reset.
export function errorFromResponse(
  status: number,
  headers: Headers,
  body: unknown,
  backoffMs: number,
): GitHubError {
  const errors = property(body, "errors");
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const message =
    stringProperty(body, "message") ?? stringProperty(first, "message") ?? `HTTP ${String(status)}`;
  if (status === HTTP_UNAUTHORIZED) return { kind: "authExpired" };
  if (status === HTTP_FORBIDDEN || status === HTTP_TOO_MANY_REQUESTS) {
    if (isRateLimit(status, message, headers)) return rateLimited(message, headers, backoffMs);
    return orgRestriction(message, headers) ?? { kind: "forbidden", message };
  }
  if (status === HTTP_NOT_FOUND || status === HTTP_GONE) return { kind: "notFound" };
  if (status === HTTP_CONFLICT) return { kind: "conflict", message };
  if (status >= HTTP_SERVER_ERROR) return { kind: "server", status };
  return { kind: "validation", message, fields: validationFields(body) };
}

export function errorFromGraphQL(
  errors: readonly unknown[],
  headers: Headers,
  backoffMs: number,
): GitHubError {
  const first = errors[0];
  const type = stringProperty(first, "type");
  const message = stringProperty(first, "message") ?? "GraphQL request failed";
  const restriction = orgRestriction(message, headers);
  if (restriction) return restriction;
  switch (type) {
    case "NOT_FOUND":
      return { kind: "notFound" };
    case "FORBIDDEN":
      return { kind: "forbidden", message };
    case "RATE_LIMITED":
      return rateLimited(message, headers, backoffMs);
    case "STALE_DATA":
      return { kind: "conflict", message };
  }
  if (type !== null && SERVER_SIDE_GRAPHQL_TYPES.has(type)) {
    return { kind: "server", status: HTTP_SERVER_ERROR };
  }
  return { kind: "validation", message, fields: [] };
}
