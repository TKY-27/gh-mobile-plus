import { readConfig, type AuthConfig } from "./config";
import { clearAccount, readAccount, type AccountCredential } from "./cookies";
import { errorKind, logFailure, refreshGrant, revokeToken } from "./github";
import { allowMethod, badRequest, HTTP_NO_CONTENT, readAccountId } from "./http";

async function revokeCredential(config: AuthConfig, credential: AccountCredential): Promise<void> {
  if ("accessToken" in credential) return revokeToken(config, credential.accessToken);
  const grant = await refreshGrant(config, credential.refreshToken);
  if (!("error" in grant)) await revokeToken(config, grant.accessToken);
}

export const onRequest = allowMethod("POST", async ({ request, env }) => {
  const config = await readConfig(env, new URL(request.url));
  const accountId = await readAccountId(request);
  if (accountId === null) return badRequest();
  const account = await readAccount(config, request, accountId);
  // Best-effort revoke; the cookie always goes.
  if (account !== null) {
    await revokeCredential(config, account.credential).catch((error: unknown) => {
      logFailure("logout", errorKind(error));
    });
  }
  return new Response(null, {
    status: HTTP_NO_CONTENT,
    headers: { "Set-Cookie": clearAccount(config, accountId) },
  });
});
