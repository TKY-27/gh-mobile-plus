import type { TadaDocumentNode } from "gql.tada";
import { print } from "@0no-co/graphql.web";
import type { AccountId } from "../session";
import {
  errorFromGraphQL,
  errorFromResponse,
  fetchOrNetworkFailure,
  gitHubFailure,
  type GitHubFailure,
} from "./errors";
import type { GitHubError } from "../errors";
import { HTTP_NOT_MODIFIED, HTTP_UNAUTHORIZED } from "./constants";
import { property, readJson } from "./json";
import {
  noteSecondaryLimit,
  recordRateLimit,
  recordRateLimitBlock,
  recordRateLimitHeaders,
  resetSecondaryBackoff,
  secondaryBackoffMs,
} from "./rate-limit";
import {
  getAccessToken,
  markAccountSignedOut,
  refreshAccessToken,
  subscribeSessionEvents,
} from "./tokens";

export const API_ORIGIN = "https://api.github.com";
export const GITHUB_JSON = "application/vnd.github+json";
export const GITHUB_HTML_JSON = "application/vnd.github.html+json";
export const GITHUB_RAW = "application/vnd.github.raw";
const API_VERSION = "2026-03-10";
const REVALIDATION_CACHE_LIMIT = 200;
const JSON_CONTENT_TYPE = /[/+]json\b/;
const NEXT_LINK = /<([^>]+)>;\s*rel="next"/;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

export interface RestRequest {
  path: string;
  method?: HttpMethod | undefined;
  query?: Readonly<Record<string, QueryValue>> | undefined;
  body?: unknown;
  accept?: string | undefined;
  signal?: AbortSignal | undefined;
  revalidate?: boolean | undefined;
}

export interface RestResponse<T> {
  status: number;
  headers: Headers;
  body: T;
  notModified: boolean;
}

interface StoredResponse {
  etag: string | null;
  lastModified: string | null;
  body: unknown;
}

// Keep private responses out of persistence.
const storedResponses = new Map<string, StoredResponse>();

subscribeSessionEvents((event) => {
  if (event.type !== "signedOut") return;
  const prefix = `${String(event.accountId)} `;
  for (const key of storedResponses.keys()) {
    if (key.startsWith(prefix)) storedResponses.delete(key);
  }
});

// Dot segments would change the resource.
export function apiPath(
  strings: TemplateStringsArray,
  ...segments: readonly (string | number)[]
): string {
  let path = strings[0] ?? "";
  segments.forEach((segment, index) => {
    const value = String(segment);
    if (value === "" || value === "." || value === "..") {
      throw gitHubFailure({ kind: "notFound" });
    }
    path += encodeURIComponent(value) + (strings[index + 1] ?? "");
  });
  return path;
}

export function nextPageUrl(headers: Headers): string | null {
  return NEXT_LINK.exec(headers.get("link") ?? "")?.[1] ?? null;
}

export function gitHubHeaders(accessToken: string, accept: string = GITHUB_JSON): Headers {
  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": API_VERSION,
    Accept: accept,
  });
}

function requestUrl(path: string, query: RestRequest["query"]): URL {
  const url = URL.parse(path, API_ORIGIN);
  // Prevent token leakage outside the API.
  if (url?.origin !== API_ORIGIN) throw gitHubFailure({ kind: "notFound" });
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(name, String(value));
  }
  return url;
}

async function sendAuthorized(
  accountId: AccountId,
  url: URL,
  request: RestRequest,
  stored: StoredResponse | undefined,
): Promise<Response> {
  const send = async (accessToken: string): Promise<Response> => {
    const headers = gitHubHeaders(accessToken, request.accept);
    if (stored?.etag) headers.set("If-None-Match", stored.etag);
    if (stored?.lastModified) headers.set("If-Modified-Since", stored.lastModified);
    if (request.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetchOrNetworkFailure(url, {
      method: request.method ?? "GET",
      headers,
      cache: "no-store",
      body: request.body === undefined ? null : JSON.stringify(request.body),
      signal: request.signal ?? null,
    });
    recordRateLimitHeaders(accountId, response.headers);
    return response;
  };
  const accessToken = await getAccessToken(accountId);
  const first = await send(accessToken);
  if (first.status !== HTTP_UNAUTHORIZED) return first;
  const retried = await send(await refreshAccessToken(accountId, accessToken));
  if (retried.status !== HTTP_UNAUTHORIZED) return retried;
  await markAccountSignedOut(accountId, "rejected");
  throw gitHubFailure({ kind: "authExpired" });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === GITHUB_HTML_JSON || !JSON_CONTENT_TYPE.test(mediaType ?? "")) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw gitHubFailure({ kind: "server", status: response.status });
    }
    throw error;
  }
}

function recordFailure(accountId: AccountId, error: GitHubError): GitHubFailure {
  if (error.kind === "rateLimited") {
    recordRateLimitBlock(accountId, error.resetAt);
    if (error.secondary) noteSecondaryLimit(accountId);
  }
  return gitHubFailure(error);
}

function storeResponse(key: string, headers: Headers, body: unknown): void {
  const etag = headers.get("etag");
  const lastModified = headers.get("last-modified");
  storedResponses.delete(key);
  if (etag === null && lastModified === null) return;
  storedResponses.set(key, { etag, lastModified, body });
  const oldest = storedResponses.keys().next();
  if (storedResponses.size > REVALIDATION_CACHE_LIMIT && !oldest.done) {
    storedResponses.delete(oldest.value);
  }
}

export async function rest<T>(
  accountId: AccountId,
  request: RestRequest,
): Promise<RestResponse<T>> {
  const method = request.method ?? "GET";
  const url = requestUrl(request.path, request.query);
  const revalidate = method === "GET" && request.revalidate === true;
  const key = `${String(accountId)} ${request.accept ?? GITHUB_JSON} ${url.href}`;
  const stored = revalidate ? storedResponses.get(key) : undefined;
  const response = await sendAuthorized(accountId, url, request, stored);
  if (response.status === HTTP_NOT_MODIFIED && stored) {
    resetSecondaryBackoff(accountId);
    // REST callers supply the documented shape.
    const body = stored.body as T;
    return { status: response.status, headers: response.headers, body, notModified: true };
  }
  if (!response.ok) {
    const body = await readJson(response);
    const backoffMs = secondaryBackoffMs(accountId);
    const error = errorFromResponse(response.status, response.headers, body, backoffMs);
    throw recordFailure(accountId, error);
  }
  resetSecondaryBackoff(accountId);
  const body = await readBody(response);
  if (revalidate) storeResponse(key, response.headers, body);
  return {
    status: response.status,
    headers: response.headers,
    body: body as T,
    notModified: false,
  };
}

function recordGraphQLRateLimit(accountId: AccountId, rateLimit: unknown): void {
  const limit = property(rateLimit, "limit");
  const remaining = property(rateLimit, "remaining");
  const resetAt = property(rateLimit, "resetAt");
  if (typeof limit !== "number" || typeof remaining !== "number") return;
  if (typeof resetAt !== "string") return;
  recordRateLimit(accountId, "graphql", { limit, remaining, resetAt: new Date(resetAt) });
}

export async function graphql<Result, Variables>(
  accountId: AccountId,
  document: TadaDocumentNode<Result, Variables>,
  variables: Variables,
  signal?: AbortSignal,
  optionalNotFoundPath?: readonly string[],
): Promise<Result> {
  const query = print(document);
  const response = await rest<unknown>(accountId, {
    method: "POST",
    path: "/graphql",
    body: { query, variables },
    signal,
  });
  const responseErrors = property(response.body, "errors");
  const errors: unknown[] = Array.isArray(responseErrors) ? responseErrors : [];
  const failures = optionalNotFoundPath
    ? errors.filter((error) => {
        const path = property(error, "path");
        return (
          property(error, "type") !== "NOT_FOUND" ||
          !Array.isArray(path) ||
          path.length !== optionalNotFoundPath.length ||
          !optionalNotFoundPath.every((field, index) => path[index] === field)
        );
      })
    : errors;
  if (failures.length > 0) {
    const backoffMs = secondaryBackoffMs(accountId);
    throw recordFailure(accountId, errorFromGraphQL(failures, response.headers, backoffMs));
  }
  const result = property(response.body, "data");
  if (typeof result !== "object" || result === null) {
    throw gitHubFailure({ kind: "server", status: response.status });
  }
  recordGraphQLRateLimit(accountId, property(result, "rateLimit"));
  // The typed document defines the response.
  return result as Result;
}
