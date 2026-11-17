import { readConfig, type AuthConfig } from "./config";
import {
  clearOAuthSession,
  readOAuthSession,
  writeAccount,
  type AccountCredential,
} from "./cookies";
import { exchangeCode, fetchUser, logFailure, revokeToken, type TokenGrant } from "./github";
import { allowMethod, callbackUri, redirect } from "./http";

const MAX_ACCOUNTS = 5;

type SignInError =
  "state_mismatch" | "access_denied" | "exchange_failed" | "org_restricted" | "account_limit";

function statesMatch(expected: string, received: string): boolean {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const receivedBytes = encoder.encode(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    crypto.subtle.timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function credentialFor(config: AuthConfig, grant: TokenGrant): AccountCredential | null {
  return config.tokenMode === "expiring"
    ? grant.refresh
    : { accessToken: grant.accessToken, refreshExpiresAt: null };
}

export const onRequest = allowMethod("GET", async ({ request, env }) => {
  const url = new URL(request.url);
  const params = url.searchParams;
  const config = await readConfig(env, url);
  const clearSession = clearOAuthSession(config);
  const fail = (error: SignInError): Response =>
    redirect(`${url.origin}/signin?error=${error}`, [clearSession]);

  const session = await readOAuthSession(config, request);
  const state = params.get("state");
  if (session === null || state === null || !statesMatch(session.state, state)) {
    return fail("state_mismatch");
  }
  if (params.get("error") === "access_denied") return fail("access_denied");
  const code = params.get("code");
  if (params.has("error") || code === null) return fail("exchange_failed");

  const grant = await exchangeCode(config, code, session.verifier, callbackUri(url.origin));
  if ("error" in grant) return fail("exchange_failed");
  // Never leave an unused grant behind.
  const discardGrant = async (error: SignInError): Promise<Response> => {
    await revokeToken(config, grant.accessToken);
    return fail(error);
  };
  const credential = credentialFor(config, grant);
  if (credential === null) {
    // The OAuth App has expiring tokens disabled.
    logFailure("exchange", "missing_refresh_token");
    return discardGrant("exchange_failed");
  }
  const user = await fetchUser(config, grant.accessToken);
  if (user === "failed") return discardGrant("exchange_failed");
  if (user === "org_restricted") return discardGrant(user);

  const known = session.knownAccountIds;
  if (!known.includes(user.id) && known.length >= MAX_ACCOUNTS) {
    return discardGrant("account_limit");
  }
  const accountCookie = await writeAccount(config, {
    id: user.id,
    login: user.login,
    avatarUrl: user.avatarUrl,
    publicOnly: session.publicOnly,
    credential,
  });
  return redirect(`${url.origin}${session.returnPath}`, [clearSession, accountCookie]);
});
