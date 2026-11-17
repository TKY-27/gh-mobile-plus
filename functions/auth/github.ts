import type { AuthConfig } from "./config";
import {
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
  isAccountId,
  isRecord,
  MILLISECONDS_PER_SECOND,
} from "./http";

const API_VERSION = "2026-03-10";
const USER_AGENT = "gh-mobile-plus-auth";
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;
const ORG_RESTRICTION_PATTERN = /OAuth App access restrictions|SAML/i;

export interface RefreshCredential {
  refreshToken: string;
  refreshExpiresAt: number;
}

export interface TokenGrant {
  accessToken: string;
  accessExpiresAt: number | null;
  refresh: RefreshCredential | null;
}

interface TokenFailure {
  error: string;
}

interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string;
}

type UserLookup = GitHubUser | "org_restricted" | "failed";

export function logFailure(operation: string, kind: string, status?: number): void {
  console.error("ghm-auth", { operation, kind, status });
}

interface GitHubReply {
  response: Response;
  body: string;
}

export function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function send(
  operation: string,
  url: string,
  init: RequestInit,
): Promise<GitHubReply | null> {
  try {
    const response = await fetch(url, init);
    // Bodies can fail after headers arrive.
    return { response, body: await response.text() };
  } catch (error) {
    logFailure(operation, errorKind(error));
    return null;
  }
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

const apiHeaders = (extra: Record<string, string>): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": API_VERSION,
  "User-Agent": USER_AGENT,
  ...extra,
});

function expiryFrom(now: number, seconds: unknown): number | null {
  return typeof seconds === "number" && seconds > 0
    ? now + seconds * MILLISECONDS_PER_SECOND
    : null;
}

function parseGrant(body: unknown, now: number): TokenGrant | TokenFailure {
  if (!isRecord(body)) return { error: "malformed_response" };
  if (typeof body.error === "string") {
    return { error: ERROR_CODE_PATTERN.test(body.error) ? body.error : "unrecognized_error" };
  }
  if (typeof body.access_token !== "string" || body.access_token === "") {
    return { error: "malformed_response" };
  }
  const refreshExpiresAt = expiryFrom(now, body.refresh_token_expires_in);
  return {
    accessToken: body.access_token,
    accessExpiresAt: expiryFrom(now, body.expires_in),
    refresh:
      typeof body.refresh_token === "string" && refreshExpiresAt !== null
        ? { refreshToken: body.refresh_token, refreshExpiresAt }
        : null,
  };
}

async function requestToken(
  config: AuthConfig,
  operation: string,
  grant: Record<string, string>,
): Promise<TokenGrant | TokenFailure> {
  // Keeps secrets out of URLs.
  const reply = await send(operation, `${config.oauthOrigin}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...grant,
    }),
  });
  if (reply === null) return { error: "network" };
  if (!reply.response.ok) {
    logFailure(operation, "http_status", reply.response.status);
    return { error: "http_status" };
  }
  const result = parseGrant(parseJson(reply.body), Date.now());
  if ("error" in result) logFailure(operation, result.error);
  return result;
}

export function exchangeCode(
  config: AuthConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenGrant | TokenFailure> {
  return requestToken(config, "exchange", {
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

export function refreshGrant(
  config: AuthConfig,
  refreshToken: string,
): Promise<TokenGrant | TokenFailure> {
  return requestToken(config, "refresh", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

function isOrgRestricted(response: Response, body: string): boolean {
  return (
    response.status === HTTP_FORBIDDEN &&
    (response.headers.has("X-GitHub-SSO") || ORG_RESTRICTION_PATTERN.test(body))
  );
}

export async function fetchUser(config: AuthConfig, accessToken: string): Promise<UserLookup> {
  const reply = await send("user", `${config.apiOrigin}/user`, {
    headers: apiHeaders({ Authorization: `Bearer ${accessToken}` }),
  });
  if (reply === null) return "failed";
  const { response } = reply;
  if (!response.ok) {
    const restricted = isOrgRestricted(response, reply.body);
    logFailure("user", restricted ? "org_restricted" : "http_status", response.status);
    return restricted ? "org_restricted" : "failed";
  }
  const body = parseJson(reply.body);
  if (
    !isRecord(body) ||
    !isAccountId(body.id) ||
    typeof body.login !== "string" ||
    typeof body.avatar_url !== "string"
  ) {
    logFailure("user", "malformed_response");
    return "failed";
  }
  return { id: body.id, login: body.login, avatarUrl: body.avatar_url };
}

export async function revokeToken(config: AuthConfig, accessToken: string): Promise<void> {
  const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
  const reply = await send(
    "revoke",
    `${config.apiOrigin}/applications/${encodeURIComponent(config.clientId)}/token`,
    {
      method: "DELETE",
      headers: apiHeaders({
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ access_token: accessToken }),
    },
  );
  if (reply !== null && reply.response.status !== HTTP_NO_CONTENT) {
    logFailure("revoke", "http_status", reply.response.status);
  }
}
