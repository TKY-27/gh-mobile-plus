import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  API_VERSION,
  CONTROL_PREFIX,
  HEALTH_PATH,
  MOCK_CLIENT_ID,
  MOCK_CLIENT_SECRET,
  MOCK_GITHUB_PORT,
  MOCK_USERS,
  SCOPE_COOKIE,
  type MockBehavior,
  type MockReport,
  type TokenIntrospection,
} from "./protocol.ts";

const HOST = "127.0.0.1";
const DEFAULT_BEHAVIOR: MockBehavior = {
  user: "mona",
  consent: "approve",
  failNextExchange: false,
  rejectRefresh: false,
  accessTokenLifetimeSeconds: 8 * 60 * 60,
};
const REFRESH_TOKEN_LIFETIME_SECONDS = 15_897_600;
const TOKEN_BYTES = 24;
const ACCESS_TOKEN_PREFIX = "ghu_";
const MILLISECONDS_PER_SECOND = 1000;
const FORM_TYPE = "application/x-www-form-urlencoded";
const GITHUB_JSON = "application/vnd.github+json";
const SCOPE_ROUTE = new RegExp(`^${CONTROL_PREFIX}/scopes/([^/]+)(/[a-z-]+)?$`);
const REVOKE_ROUTE = /^\/applications\/([^/]+)\/token$/;
const Status = {
  ok: 200,
  noContent: 204,
  found: 302,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  methodNotAllowed: 405,
  internalError: 500,
} as const;

class BadRequestError extends Error {
  override name = "BadRequestError";
}

interface Scope {
  behavior: MockBehavior;
  report: MockReport;
}

interface Grant {
  scope: Scope;
  userId: number;
}

interface PendingCode extends Grant {
  challenge: string;
  redirectUri: string;
}

interface AccessGrant extends Grant {
  expiresAt: number;
}

interface RefreshGrant extends Grant {
  accessToken: string;
  used: boolean;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const scopes = new Map<string, Scope>();
const codes = new Map<string, PendingCode>();
const accessTokens = new Map<string, AccessGrant>();
const refreshTokens = new Map<string, RefreshGrant>();

const json = (body: unknown, status: number = Status.ok): Reply => ({ status, body });
const failure = (status: number, message: string): Reply => ({ status, body: { message } });
const tokenError = (error: string): Reply => json({ error });

function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function userById(id: number) {
  const user = Object.values(MOCK_USERS).find((candidate) => candidate.id === id);
  if (!user) throw new Error(`Unknown mock user ${String(id)}`);
  return user;
}

function newScope(): Scope {
  return {
    behavior: { ...DEFAULT_BEHAVIOR },
    report: {
      exchanges: 0,
      refreshes: 0,
      rejectedRefreshes: 0,
      revocations: 0,
      pkceFailures: 0,
      secrets: [],
      authorizations: [],
    },
  };
}

function readCookie(request: IncomingMessage, name: string): string | null {
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new BadRequestError("Body is not JSON");
    throw error;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestError("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function mergeBehavior(behavior: MockBehavior, patch: Record<string, unknown>): void {
  const { user, consent, failNextExchange, rejectRefresh, accessTokenLifetimeSeconds } = patch;
  if (user === "mona" || user === "hubot") behavior.user = user;
  if (consent === "approve" || consent === "deny") behavior.consent = consent;
  if (typeof failNextExchange === "boolean") behavior.failNextExchange = failNextExchange;
  if (typeof rejectRefresh === "boolean") behavior.rejectRefresh = rejectRefresh;
  if (typeof accessTokenLifetimeSeconds === "number" && accessTokenLifetimeSeconds > 0) {
    behavior.accessTokenLifetimeSeconds = accessTokenLifetimeSeconds;
  }
}

function authorize(request: IncomingMessage, url: URL): Reply {
  const scope = scopes.get(readCookie(request, SCOPE_COOKIE) ?? "");
  if (!scope) return failure(Status.badRequest, "Unknown test scope; use the e2e support fixtures");
  const params = url.searchParams;
  const state = params.get("state") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (
    params.get("client_id") !== MOCK_CLIENT_ID ||
    params.get("code_challenge_method") !== "S256" ||
    state === "" ||
    challenge === "" ||
    !URL.canParse(redirectUri)
  ) {
    return failure(Status.badRequest, "Malformed authorization request");
  }
  scope.report.authorizations.push(Object.fromEntries(params));
  const target = new URL(redirectUri);
  if (scope.behavior.consent === "deny") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "The user has denied your application access.");
  } else {
    const code = randomToken("");
    const userId = MOCK_USERS[scope.behavior.user].id;
    codes.set(code, { scope, userId, challenge, redirectUri });
    scope.report.secrets.push(code);
    target.searchParams.set("code", code);
  }
  target.searchParams.set("state", state);
  return { status: Status.found, headers: { Location: target.href } };
}

function issueTokens(grant: Grant): Reply {
  const { scope, userId } = grant;
  const lifetime = scope.behavior.accessTokenLifetimeSeconds;
  const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomToken("ghr_");
  accessTokens.set(accessToken, {
    scope,
    userId,
    expiresAt: Date.now() + lifetime * MILLISECONDS_PER_SECOND,
  });
  refreshTokens.set(refreshToken, { scope, userId, accessToken, used: false });
  scope.report.secrets.push(accessToken, refreshToken);
  return json({
    access_token: accessToken,
    expires_in: lifetime,
    refresh_token: refreshToken,
    refresh_token_expires_in: REFRESH_TOKEN_LIFETIME_SECONDS,
    token_type: "bearer",
    scope: "",
  });
}

function exchangeCode(form: URLSearchParams): Reply {
  const code = form.get("code") ?? "";
  const pending = codes.get(code);
  if (!pending) return tokenError("bad_verification_code");
  codes.delete(code);
  const { report, behavior } = pending.scope;
  report.exchanges++;
  const verifier = form.get("code_verifier") ?? "";
  if (verifier !== "") report.secrets.push(verifier);
  if (behavior.failNextExchange) {
    behavior.failNextExchange = false;
    return tokenError("bad_verification_code");
  }
  if (form.get("redirect_uri") !== pending.redirectUri) return tokenError("redirect_uri_mismatch");
  if (s256(verifier) !== pending.challenge) {
    report.pkceFailures++;
    return tokenError("bad_verification_code");
  }
  return issueTokens(pending);
}

function refresh(form: URLSearchParams): Reply {
  const grant = refreshTokens.get(form.get("refresh_token") ?? "");
  if (!grant) return tokenError("bad_refresh_token");
  const { report, behavior } = grant.scope;
  if (grant.used || behavior.rejectRefresh) {
    report.rejectedRefreshes++;
    return tokenError("bad_refresh_token");
  }
  report.refreshes++;
  grant.used = true;
  // Reject stale tokens to expose refresh races.
  accessTokens.delete(grant.accessToken);
  return issueTokens(grant);
}

async function accessToken(request: IncomingMessage, url: URL): Promise<Reply> {
  if (request.method !== "POST") return failure(Status.methodNotAllowed, "POST only");
  // URL secrets leak into logs.
  if (url.search !== "") return failure(Status.badRequest, "Token parameters must be in the body");
  if (request.headers.accept !== "application/json")
    return failure(Status.badRequest, "Accept must be JSON");
  if (request.headers["content-type"] !== FORM_TYPE)
    return failure(Status.badRequest, "Body must be a form");
  const form = new URLSearchParams(await readBody(request));
  if (
    form.get("client_id") !== MOCK_CLIENT_ID ||
    form.get("client_secret") !== MOCK_CLIENT_SECRET
  ) {
    return tokenError("incorrect_client_credentials");
  }
  return form.get("grant_type") === "refresh_token" ? refresh(form) : exchangeCode(form);
}

function activeGrant(token: string): AccessGrant | null {
  const grant = accessTokens.get(token);
  return grant && grant.expiresAt > Date.now() ? grant : null;
}

function hasApiHeaders(request: IncomingMessage): boolean {
  return (
    request.headers.accept === GITHUB_JSON &&
    request.headers["x-github-api-version"] === API_VERSION
  );
}

function user(request: IncomingMessage): Reply {
  if (!hasApiHeaders(request)) return failure(Status.badRequest, "Missing GitHub API headers");
  const bearer = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "");
  const grant = bearer?.[1] === undefined ? null : activeGrant(bearer[1]);
  if (!grant) return failure(Status.unauthorized, "Bad credentials");
  const { id, login } = userById(grant.userId);
  return json({ id, login, avatar_url: `https://avatars.githubusercontent.com/u/${String(id)}` });
}

async function revoke(request: IncomingMessage, clientId: string): Promise<Reply> {
  const basic = Buffer.from(`${MOCK_CLIENT_ID}:${MOCK_CLIENT_SECRET}`).toString("base64");
  if (
    request.method !== "DELETE" ||
    decodeURIComponent(clientId) !== MOCK_CLIENT_ID ||
    request.headers.authorization !== `Basic ${basic}` ||
    !hasApiHeaders(request)
  ) {
    return failure(Status.unauthorized, "Bad credentials");
  }
  const token = parseJsonObject(await readBody(request)).access_token;
  const grant = typeof token === "string" ? accessTokens.get(token) : undefined;
  if (typeof token !== "string" || !grant) return failure(Status.notFound, "Not Found");
  accessTokens.delete(token);
  grant.scope.report.revocations++;
  return { status: Status.noContent };
}

function introspect(scope: Scope, token: unknown): TokenIntrospection {
  if (typeof token !== "string") throw new BadRequestError("Missing token");
  const grant = activeGrant(token);
  const active = grant?.scope === scope;
  return {
    issued: token.startsWith(ACCESS_TOKEN_PREFIX) && scope.report.secrets.includes(token),
    active,
    userId: active ? grant.userId : null,
  };
}

function expireAccessTokens(scope: Scope): void {
  for (const grant of accessTokens.values()) {
    if (grant.scope === scope) grant.expiresAt = 0;
  }
}

async function control(request: IncomingMessage, path: string): Promise<Reply> {
  if (path === HEALTH_PATH) return { status: Status.noContent };
  const match = SCOPE_ROUTE.exec(path);
  const id = match?.[1] === undefined ? null : decodeURIComponent(match[1]);
  if (id === null) return failure(Status.notFound, "Unknown control route");
  const action = `${request.method ?? ""} ${match?.[2] ?? ""}`;
  if (action === "PUT ") {
    const scope = scopes.get(id) ?? newScope();
    mergeBehavior(scope.behavior, parseJsonObject(await readBody(request)));
    scopes.set(id, scope);
    return { status: Status.noContent };
  }
  const scope = scopes.get(id);
  if (!scope) return failure(Status.notFound, "Unknown test scope");
  switch (action) {
    case "GET ":
      return json(scope.report);
    case "DELETE ":
      scopes.delete(id);
      return { status: Status.noContent };
    case "POST /introspect":
      return json(introspect(scope, parseJsonObject(await readBody(request)).token));
    case "POST /expire-access-tokens":
      expireAccessTokens(scope);
      return { status: Status.noContent };
    default:
      return failure(Status.notFound, "Unknown control route");
  }
}

function route(request: IncomingMessage): Promise<Reply> | Reply {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  const path = url.pathname;
  if (path.startsWith(`${CONTROL_PREFIX}/`)) return control(request, path);
  if (path === "/login/oauth/authorize" && request.method === "GET") {
    return authorize(request, url);
  }
  if (path === "/login/oauth/access_token") return accessToken(request, url);
  if (path === "/user" && request.method === "GET") return user(request);
  const revokeMatch = REVOKE_ROUTE.exec(path);
  if (revokeMatch?.[1] !== undefined) return revoke(request, revokeMatch[1]);
  return failure(Status.notFound, "Not Found");
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers).end();
    return;
  }
  headers["Content-Type"] = "application/json";
  response.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
}

createServer((request, response) => {
  Promise.resolve(route(request)).then(
    (reply) => {
      send(response, reply);
    },
    (error: unknown) => {
      if (error instanceof BadRequestError) {
        send(response, failure(Status.badRequest, error.message));
        return;
      }
      console.error("mock-github", error);
      send(response, failure(Status.internalError, "Mock server error"));
    },
  );
}).listen(MOCK_GITHUB_PORT, HOST);
