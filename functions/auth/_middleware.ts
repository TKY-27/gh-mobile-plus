import { MisconfiguredError } from "./config";
import { errorKind, logFailure } from "./github";
import { HTTP_FORBIDDEN, HTTP_INTERNAL_SERVER_ERROR, jsonError, type AuthFunction } from "./http";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function isTrustedRequest(request: Request): boolean {
  if (request.method === "GET") return true;
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    request.headers.get("X-GHM-Request") === "1"
  );
}

const guard: AuthFunction = async (context) => {
  if (!isTrustedRequest(context.request)) return jsonError(HTTP_FORBIDDEN, "forbidden");
  try {
    return await context.next();
  } catch (error) {
    if (error instanceof MisconfiguredError) {
      logFailure("config", error.message);
      return jsonError(HTTP_INTERNAL_SERVER_ERROR, "server_misconfigured");
    }
    // Never echo error details to clients.
    logFailure("unexpected", errorKind(error));
    return jsonError(HTTP_INTERNAL_SERVER_ERROR, "internal_error");
  }
};

export const onRequest: AuthFunction = async (context) => {
  const response = await guard(context);
  const hardened = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) hardened.headers.set(name, value);
  return hardened;
};
