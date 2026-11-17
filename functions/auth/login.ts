import { readConfig } from "./config";
import { readAccounts, writeOAuthSession, type LoginMode } from "./cookies";
import { toBase64Url } from "./envelope";
import { allowMethod, badRequest, callbackUri, parseAccountId, redirect } from "./http";

const RANDOM_BYTES = 32;
const SHARED_SCOPES = "notifications workflow read:org read:user user:email user:follow";
const DEFAULT_RETURN_PATH = "/";
// eslint-disable-next-line no-control-regex -- intentional
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

interface LoginRequest {
  mode: LoginMode;
  publicOnly: boolean;
}

const randomToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

function parseLoginRequest(params: URLSearchParams): LoginRequest | null {
  const mode = params.get("mode") ?? "add";
  const publicParam = params.get("public") ?? "0";
  const accountParam = params.get("account");
  const account = accountParam === null ? null : parseAccountId(accountParam);
  if (
    (mode !== "add" && mode !== "reauth") ||
    (publicParam !== "0" && publicParam !== "1") ||
    (accountParam !== null && account === null) ||
    (mode === "reauth" && account === null)
  ) {
    return null;
  }
  return { mode, publicOnly: publicParam === "1" };
}

function safeReturnPath(raw: string | null, origin: string): string {
  // Parsers turn backslashes and controls into "//".
  if (
    raw === null ||
    !raw.startsWith("/") ||
    UNSAFE_PATH_CHARACTERS.test(raw) ||
    !URL.canParse(raw, origin)
  ) {
    return DEFAULT_RETURN_PATH;
  }
  const target = new URL(raw, origin);
  const path = `${target.pathname}${target.search}${target.hash}`;
  return target.origin === origin && !path.startsWith("//") ? path : DEFAULT_RETURN_PATH;
}

export const onRequest = allowMethod("GET", async ({ request, env }) => {
  const url = new URL(request.url);
  const config = await readConfig(env, url);
  const login = parseLoginRequest(url.searchParams);
  if (login === null) return badRequest();
  const state = randomToken();
  const verifier = randomToken();
  const authorize = new URL("/login/oauth/authorize", config.oauthOrigin);
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUri(url.origin),
    scope: `${login.publicOnly ? "public_repo" : "repo"} ${SHARED_SCOPES}`,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
    ...(login.mode === "add" ? { prompt: "select_account" } : {}),
  }).toString();
  // Strict cookies skip the cross-site callback.
  const accounts = await readAccounts(config, request);
  const cookie = await writeOAuthSession(config, {
    ...login,
    knownAccountIds: accounts.map((account) => account.id),
    state,
    verifier,
    returnPath: safeReturnPath(url.searchParams.get("return"), url.origin),
  });
  return redirect(authorize.toString(), [cookie]);
});
