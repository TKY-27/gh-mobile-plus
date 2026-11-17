import { importCookieKeys, type CookieKeys } from "./envelope";

const DEFAULT_OAUTH_ORIGIN = "https://github.com";
const DEFAULT_API_ORIGIN = "https://api.github.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

type TokenMode = "expiring" | "persistent";

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  keys: CookieKeys;
  tokenMode: TokenMode;
  oauthOrigin: string;
  apiOrigin: string;
  secureCookies: boolean;
}

export class MisconfiguredError extends Error {
  override name = "MisconfiguredError";
}

function readTokenMode(value: string | undefined): TokenMode {
  if (value === undefined || value === "" || value === "expiring") return "expiring";
  if (value === "persistent") return value;
  throw new MisconfiguredError("GHM_TOKEN_MODE");
}

function readOrigin(
  value: string | undefined,
  fallback: string,
  name: string,
  isLocalHost: boolean,
): string {
  if (!isLocalHost || value === undefined || value === "") return fallback;
  if (!URL.canParse(value)) throw new MisconfiguredError(name);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MisconfiguredError(name);
  return url.origin;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new MisconfiguredError(name);
  return value;
}

export async function readConfig(env: Cloudflare.Env, requestUrl: URL): Promise<AuthConfig> {
  const keys = await importCookieKeys(
    required(env.GHM_COOKIE_KEYS, "GHM_COOKIE_KEYS"),
    required(env.GHM_COOKIE_ACTIVE_KID, "GHM_COOKIE_ACTIVE_KID"),
  );
  if (keys === null) throw new MisconfiguredError("GHM_COOKIE_KEYS");
  // Test-only overrides must never redirect production secrets.
  const isLocalHost = LOCAL_HOSTS.has(requestUrl.hostname);
  return {
    clientId: required(env.GHM_GITHUB_CLIENT_ID, "GHM_GITHUB_CLIENT_ID"),
    clientSecret: required(env.GHM_GITHUB_CLIENT_SECRET, "GHM_GITHUB_CLIENT_SECRET"),
    keys,
    tokenMode: readTokenMode(env.GHM_TOKEN_MODE),
    oauthOrigin: readOrigin(
      env.GHM_GITHUB_OAUTH_ORIGIN,
      DEFAULT_OAUTH_ORIGIN,
      "GHM_GITHUB_OAUTH_ORIGIN",
      isLocalHost,
    ),
    apiOrigin: readOrigin(
      env.GHM_GITHUB_API_ORIGIN,
      DEFAULT_API_ORIGIN,
      "GHM_GITHUB_API_ORIGIN",
      isLocalHost,
    ),
    secureCookies: !(env.GHM_DEV_INSECURE_COOKIES === "1" && isLocalHost),
  };
}
