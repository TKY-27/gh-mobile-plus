export const MOCK_GITHUB_PORT = 8790;
export const MOCK_GITHUB_ORIGIN = `http://127.0.0.1:${String(MOCK_GITHUB_PORT)}`;
export const MOCK_CLIENT_ID = "Iv1.e2emockclient";
export const MOCK_CLIENT_SECRET = "e2e-mock-client-secret";
export const API_VERSION = "2026-03-10";
// Isolates parallel tests sharing one mock.
export const SCOPE_COOKIE = "ghm_mock_scope";
export const CONTROL_PREFIX = "/__control";
export const HEALTH_PATH = `${CONTROL_PREFIX}/health`;

export const MOCK_USERS = {
  mona: { id: 1001, login: "mona" },
  hubot: { id: 1002, login: "hubot" },
} as const;
export type MockUserName = keyof typeof MOCK_USERS;

export interface MockBehavior {
  user: MockUserName;
  consent: "approve" | "deny";
  failNextExchange: boolean;
  rejectRefresh: boolean;
  accessTokenLifetimeSeconds: number;
}

export interface MockReport {
  exchanges: number;
  refreshes: number;
  rejectedRefreshes: number;
  revocations: number;
  pkceFailures: number;
  secrets: string[];
  authorizations: Record<string, string>[];
}

export interface TokenIntrospection {
  issued: boolean;
  active: boolean;
  userId: number | null;
}

export function scopePath(scope: string, action = ""): string {
  return `${CONTROL_PREFIX}/scopes/${encodeURIComponent(scope)}${action}`;
}
