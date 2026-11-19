import type { AuthConfig } from "./config";
import { open, seal } from "./envelope";
import type { RefreshCredential } from "./github";
import { isAccountId, isRecord, MILLISECONDS_PER_SECOND, parseAccountId } from "./http";

const SECURE_PREFIX = "__Host-";
const OAUTH_COOKIE = "ghm_oauth";
const ACCOUNT_COOKIE_PREFIX = "ghm_acct_";
const OAUTH_MAX_AGE_SECONDS = 600;
const EXPIRED_MAX_AGE_SECONDS = 0;
const PAYLOAD_VERSION = 1;
// Browsers cap cookie lifetime at 400 days.
const PERSISTENT_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

type SameSite = "Lax" | "Strict";
export type LoginMode = "add" | "reauth" | "profile";

export type AccountCredential = RefreshCredential | { accessToken: string; refreshExpiresAt: null };

interface Account {
  id: number;
  login: string;
  avatarUrl: string;
  publicOnly: boolean;
  credential: AccountCredential;
}

interface OAuthSession {
  state: string;
  verifier: string;
  mode: LoginMode;
  expectedAccountId?: number;
  knownAccountIds: number[];
  publicOnly: boolean;
  returnPath: string;
}

function cookieName(config: AuthConfig, baseName: string): string {
  return config.secureCookies ? `${SECURE_PREFIX}${baseName}` : baseName;
}

function serializeCookie(
  config: AuthConfig,
  name: string,
  value: string,
  maxAgeSeconds: number,
  sameSite: SameSite,
): string {
  const secure = config.secureCookies ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`;
}

function readCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0)
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return cookies;
}

async function openCookie(config: AuthConfig, request: Request, name: string): Promise<unknown> {
  const envelope = readCookies(request).get(name);
  const plaintext = envelope === undefined ? null : await open(config.keys, name, envelope);
  // Authenticated plaintext is JSON we wrote.
  return plaintext === null ? null : JSON.parse(plaintext);
}

function parseCredential(value: Record<string, unknown>): AccountCredential | null {
  if (typeof value.refreshToken === "string" && typeof value.refreshExpiresAt === "number") {
    return { refreshToken: value.refreshToken, refreshExpiresAt: value.refreshExpiresAt };
  }
  if (typeof value.accessToken === "string" && value.refreshExpiresAt === null) {
    return { accessToken: value.accessToken, refreshExpiresAt: null };
  }
  return null;
}

function parseAccount(id: number, value: unknown): Account | null {
  if (
    !isRecord(value) ||
    value.v !== PAYLOAD_VERSION ||
    typeof value.login !== "string" ||
    typeof value.avatarUrl !== "string" ||
    typeof value.publicOnly !== "boolean"
  ) {
    return null;
  }
  const credential = parseCredential(value);
  return credential === null
    ? null
    : {
        id,
        login: value.login,
        avatarUrl: value.avatarUrl,
        publicOnly: value.publicOnly,
        credential,
      };
}

function parseOAuthSession(value: unknown): OAuthSession | null {
  if (
    !isRecord(value) ||
    typeof value.state !== "string" ||
    typeof value.verifier !== "string" ||
    (value.mode !== "add" && value.mode !== "reauth" && value.mode !== "profile") ||
    (value.mode !== "add" && !isAccountId(value.expectedAccountId)) ||
    !Array.isArray(value.knownAccountIds) ||
    !value.knownAccountIds.every(isAccountId) ||
    typeof value.publicOnly !== "boolean" ||
    typeof value.returnPath !== "string"
  ) {
    return null;
  }
  return {
    state: value.state,
    verifier: value.verifier,
    mode: value.mode,
    ...(isAccountId(value.expectedAccountId) ? { expectedAccountId: value.expectedAccountId } : {}),
    knownAccountIds: value.knownAccountIds,
    publicOnly: value.publicOnly,
    returnPath: value.returnPath,
  };
}

export async function writeOAuthSession(
  config: AuthConfig,
  session: OAuthSession,
): Promise<string> {
  const name = cookieName(config, OAUTH_COOKIE);
  const envelope = await seal(config.keys, name, JSON.stringify(session));
  return serializeCookie(config, name, envelope, OAUTH_MAX_AGE_SECONDS, "Lax");
}

export async function readOAuthSession(
  config: AuthConfig,
  request: Request,
): Promise<OAuthSession | null> {
  return parseOAuthSession(await openCookie(config, request, cookieName(config, OAUTH_COOKIE)));
}

export function clearOAuthSession(config: AuthConfig): string {
  return serializeCookie(
    config,
    cookieName(config, OAUTH_COOKIE),
    "",
    EXPIRED_MAX_AGE_SECONDS,
    "Lax",
  );
}

const accountCookieName = (config: AuthConfig, id: number): string =>
  cookieName(config, `${ACCOUNT_COOKIE_PREFIX}${String(id)}`);

export async function writeAccount(config: AuthConfig, account: Account): Promise<string> {
  const { id, credential, ...profile } = account;
  const name = accountCookieName(config, id);
  const payload = JSON.stringify({ v: PAYLOAD_VERSION, ...profile, ...credential });
  const maxAgeSeconds =
    "refreshToken" in credential
      ? Math.max(
          EXPIRED_MAX_AGE_SECONDS,
          Math.ceil((credential.refreshExpiresAt - Date.now()) / MILLISECONDS_PER_SECOND),
        )
      : PERSISTENT_MAX_AGE_SECONDS;
  return serializeCookie(
    config,
    name,
    await seal(config.keys, name, payload),
    maxAgeSeconds,
    "Strict",
  );
}

export async function readAccount(
  config: AuthConfig,
  request: Request,
  id: number,
): Promise<Account | null> {
  return parseAccount(id, await openCookie(config, request, accountCookieName(config, id)));
}

export async function readAccounts(config: AuthConfig, request: Request): Promise<Account[]> {
  const prefix = cookieName(config, ACCOUNT_COOKIE_PREFIX);
  const ids = [...readCookies(request).keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => parseAccountId(name.slice(prefix.length)))
    .filter((id) => id !== null);
  const accounts = await Promise.all(ids.map((id) => readAccount(config, request, id)));
  return accounts
    .filter((account): account is Account => account !== null)
    .sort((left, right) => left.id - right.id);
}

export function clearAccount(config: AuthConfig, id: number): string {
  return serializeCookie(
    config,
    accountCookieName(config, id),
    "",
    EXPIRED_MAX_AGE_SECONDS,
    "Strict",
  );
}
