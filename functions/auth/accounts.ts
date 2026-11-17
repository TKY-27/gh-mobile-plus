import { readConfig } from "./config";
import { readAccounts } from "./cookies";
import { allowMethod } from "./http";

export const onRequest = allowMethod("GET", async ({ request, env }) => {
  const config = await readConfig(env, new URL(request.url));
  const accounts = await readAccounts(config, request);
  return Response.json(
    accounts.map(({ id, login, avatarUrl, publicOnly }) => ({ id, login, avatarUrl, publicOnly })),
    { headers: { "X-GHM-Client-Id": config.clientId } },
  );
});
