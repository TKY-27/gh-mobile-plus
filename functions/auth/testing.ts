import { createPagesEventContext, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import { onRequest as middleware } from "./_middleware";
import { onRequest as accounts } from "./accounts";
import { onRequest as callback } from "./callback";
import type { AuthFunction } from "./http";
import { onRequest as login } from "./login";
import { onRequest as logout } from "./logout";
import { onRequest as token } from "./token";

export const APP_ORIGIN = "https://ghm.example";
export const OAUTH_ORIGIN = "https://github.com";
export const API_ORIGIN = "https://api.github.com";
export const CLIENT_ID = "Ov23test";
export const CLIENT_SECRET = "client-secret-value";
export const KEY_ONE = btoa("1".repeat(32));
export const KEY_TWO = btoa("2".repeat(32));
export const ACCESS_TOKEN_SECONDS = 28_800;
export const REFRESH_TOKEN_SECONDS = 15_897_600;

type IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export const testEnv: Cloudflare.Env = {
  GHM_GITHUB_CLIENT_ID: CLIENT_ID,
  GHM_GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GHM_COOKIE_KEYS: JSON.stringify({ k1: KEY_ONE }),
  GHM_COOKIE_ACTIVE_KID: "k1",
};

const routes = new Map<string, AuthFunction>([
  ["/auth/login", login],
  ["/auth/callback", callback],
  ["/auth/token", token],
  ["/auth/accounts", accounts],
  ["/auth/logout", logout],
]);

export async function callAuth(
  request: IncomingRequest,
  env: Cloudflare.Env = testEnv,
): Promise<Response> {
  const route = routes.get(new URL(request.url).pathname);
  if (route === undefined) throw new Error(`No auth route for ${request.url}`);
  const withEnv = (forwarded: IncomingRequest) => {
    const context = createPagesEventContext<AuthFunction>({
      request: forwarded,
      params: {},
      data: {},
    });
    return { ...context, env: { ...context.env, ...env } };
  };
  const context = {
    ...withEnv(request),
    next: () => Promise.resolve(route(withEnv(request))),
  };
  const response = await middleware(context);
  await waitOnExecutionContext(context);
  return response;
}

interface StoredCookie {
  value: string;
  strict: boolean;
}

export class CookieJar {
  readonly #cookies = new Map<string, StoredCookie>();

  store(response: Response): this {
    for (const header of response.headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (/;\s*Max-Age=0(;|$)/i.test(header)) this.#cookies.delete(name);
      else {
        const strict = /;\s*SameSite=Strict(;|$)/i.test(header);
        this.#cookies.set(name, { value: pair.slice(separator + 1), strict });
      }
    }
    return this;
  }

  set(name: string, value: string): this {
    this.#cookies.set(name, { value, strict: true });
    return this;
  }

  get(name: string): string | undefined {
    return this.#cookies.get(name)?.value;
  }

  names(): string[] {
    return [...this.#cookies.keys()];
  }

  // Browsers withhold SameSite=Strict cookies on cross-site navigations.
  header(crossSite = false): string {
    return [...this.#cookies]
      .filter(([, cookie]) => !(crossSite && cookie.strict))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  }
}

export function getRequest(
  path: string,
  jar = new CookieJar(),
  origin = APP_ORIGIN,
  crossSite = false,
): IncomingRequest {
  return new Request<unknown, IncomingRequestCfProperties>(`${origin}${path}`, {
    headers: { Cookie: jar.header(crossSite) },
  });
}

export function postRequest(
  path: string,
  body: unknown,
  jar = new CookieJar(),
  headers: Record<string, string> = { Origin: APP_ORIGIN, "X-GHM-Request": "1" },
): IncomingRequest {
  return new Request<unknown, IncomingRequestCfProperties>(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: { ...headers, Cookie: jar.header(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function failingBody(): Response {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(new TypeError("connection reset"));
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/json" } });
}

export async function readForm(request: Request | undefined): Promise<Record<string, unknown>> {
  if (request === undefined) throw new Error("Expected a GitHub request");
  return Object.fromEntries(await request.formData());
}

type GitHubRoute = (request: Request) => Response | Promise<Response>;

export function mockGitHub(handlers: Record<string, GitHubRoute>): Request[] {
  const requests: Request[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const handler = handlers[`${request.method} ${request.url}`];
    if (handler === undefined) throw new Error(`Unexpected ${request.method} ${request.url}`);
    return Promise.resolve(handler(request));
  });
  return requests;
}

export const TOKEN_URL = `POST ${OAUTH_ORIGIN}/login/oauth/access_token`;
export const USER_URL = `GET ${API_ORIGIN}/user`;
export const REVOKE_URL = `DELETE ${API_ORIGIN}/applications/${CLIENT_ID}/token`;

export function grantResponse(suffix: string, overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: `gho_access_${suffix}`,
    token_type: "bearer",
    scope: "",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: `ghr_refresh_${suffix}`,
    refresh_token_expires_in: REFRESH_TOKEN_SECONDS,
    ...overrides,
  });
}

export function userResponse(id: number): Response {
  return Response.json({
    id,
    login: `user${String(id)}`,
    avatar_url: `https://avatars.githubusercontent.com/u/${String(id)}`,
  });
}

export async function startLogin(
  query: string,
  jar = new CookieJar(),
  env: Cloudflare.Env = testEnv,
  origin = APP_ORIGIN,
): Promise<{ response: Response; authorize: URL }> {
  const response = await callAuth(getRequest(`/auth/login?${query}`, jar, origin), env);
  jar.store(response);
  return { response, authorize: new URL(response.headers.get("Location") ?? "") };
}

export async function finishLogin(
  authorize: URL,
  jar: CookieJar,
  env: Cloudflare.Env = testEnv,
  origin = APP_ORIGIN,
): Promise<Response> {
  const state = authorize.searchParams.get("state") ?? "";
  const response = await callAuth(
    getRequest(`/auth/callback?code=code-value&state=${state}`, jar, origin, true),
    env,
  );
  jar.store(response);
  return response;
}

export async function signIn(
  userId: number,
  jar = new CookieJar(),
  options: { query?: string; env?: Cloudflare.Env; suffix?: string } = {},
): Promise<Response> {
  mockGitHub({
    [TOKEN_URL]: () => grantResponse(options.suffix ?? String(userId)),
    [USER_URL]: () => userResponse(userId),
    [REVOKE_URL]: () => new Response(null, { status: 204 }),
  });
  const { authorize } = await startLogin(options.query ?? "mode=add", jar, options.env);
  return finishLogin(authorize, jar, options.env);
}
