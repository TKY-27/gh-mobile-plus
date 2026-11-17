export const HTTP_NO_CONTENT = 204;
export const HTTP_FOUND = 302;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_FORBIDDEN = 403;
export const HTTP_METHOD_NOT_ALLOWED = 405;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;
export const MILLISECONDS_PER_SECOND = 1000;
const ACCOUNT_ID_PATTERN = /^[1-9]\d*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonError(status: number, error: string, headers: HeadersInit = {}): Response {
  return Response.json({ error }, { status, headers });
}

export function redirect(location: string, cookies: readonly string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: HTTP_FOUND, headers });
}

export const callbackUri = (origin: string): string => `${origin}/auth/callback`;

export type AuthFunction = PagesFunction<Cloudflare.Env>;

export function allowMethod(method: "GET" | "POST", handler: AuthFunction): AuthFunction {
  return (context) =>
    context.request.method === method
      ? handler(context)
      : new Response(null, { status: HTTP_METHOD_NOT_ALLOWED, headers: { Allow: method } });
}

export function isAccountId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseAccountId(text: string): number | null {
  const id = Number(text);
  return ACCOUNT_ID_PATTERN.test(text) && isAccountId(id) ? id : null;
}

export async function readAccountId(request: Request): Promise<number | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(body) || Object.keys(body).length !== 1) return null;
  return isAccountId(body.accountId) ? body.accountId : null;
}

export const badRequest = (): Response => jsonError(HTTP_BAD_REQUEST, "invalid_request");
