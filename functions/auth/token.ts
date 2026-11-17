import { readConfig } from "./config";
import { clearAccount, readAccount, writeAccount } from "./cookies";
import { logFailure, refreshGrant } from "./github";
import {
  allowMethod,
  badRequest,
  HTTP_BAD_GATEWAY,
  HTTP_UNAUTHORIZED,
  jsonError,
  readAccountId,
} from "./http";

export const onRequest = allowMethod("POST", async ({ request, env }) => {
  const config = await readConfig(env, new URL(request.url));
  const accountId = await readAccountId(request);
  if (accountId === null) return badRequest();
  const reauthRequired = (): Response =>
    jsonError(HTTP_UNAUTHORIZED, "reauth_required", {
      "Set-Cookie": clearAccount(config, accountId),
    });
  const upstreamFailed = (): Response => jsonError(HTTP_BAD_GATEWAY, "upstream_failed");

  const account = await readAccount(config, request, accountId);
  if (account === null) return reauthRequired();
  const { credential } = account;
  if (config.tokenMode === "persistent") {
    return "accessToken" in credential
      ? Response.json({ accessToken: credential.accessToken, expiresAt: null })
      : reauthRequired();
  }
  if (!("refreshToken" in credential)) return reauthRequired();

  const grant = await refreshGrant(config, credential.refreshToken);
  if ("error" in grant) {
    return grant.error === "bad_refresh_token" ? reauthRequired() : upstreamFailed();
  }
  if (grant.refresh === null || grant.accessExpiresAt === null) {
    logFailure("refresh", "missing_expiry_fields");
    return upstreamFailed();
  }
  const cookie = await writeAccount(config, { ...account, credential: grant.refresh });
  return Response.json(
    { accessToken: grant.accessToken, expiresAt: grant.accessExpiresAt },
    { headers: { "Set-Cookie": cookie } },
  );
});
