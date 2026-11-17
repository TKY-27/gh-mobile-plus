export type GitHubError =
  | { kind: "authExpired" }
  | { kind: "orgAccessRestricted"; org: string; ssoUrl?: string }
  | { kind: "rateLimited"; resetAt: Date; secondary: boolean }
  | { kind: "notFound" }
  | { kind: "forbidden"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "validation"; message: string; fields: string[] }
  | { kind: "network" }
  | { kind: "server"; status: number };

const GITHUB_ERROR_KINDS: ReadonlySet<unknown> = new Set<GitHubError["kind"]>([
  "authExpired",
  "orgAccessRestricted",
  "rateLimited",
  "notFound",
  "forbidden",
  "conflict",
  "validation",
  "network",
  "server",
]);
const APPLICATION_SETTINGS_URL = "https://github.com/settings/connections/applications/";
const AUTHORIZED_APPS_URL = "https://github.com/settings/applications";

let oauthClientId: string | null = null;

export function rememberOAuthClientId(clientId: string | null): void {
  oauthClientId = clientId;
}

export function isGitHubError(value: unknown): value is GitHubError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    GITHUB_ERROR_KINDS.has(value.kind)
  );
}

export function orgApprovalUrl(): string {
  // Unknown client id: list all authorized apps.
  return oauthClientId
    ? APPLICATION_SETTINGS_URL + encodeURIComponent(oauthClientId)
    : AUTHORIZED_APPS_URL;
}

function describe(error: GitHubError): string {
  switch (error.kind) {
    case "orgAccessRestricted":
      // ssoUrl embeds an authorization request id.
      return `org=${error.org || "unknown"}`;
    case "rateLimited":
      return `resetAt=${error.resetAt.toISOString()} secondary=${String(error.secondary)}`;
    case "forbidden":
    case "conflict":
      return `message=${error.message}`;
    case "validation":
      return `message=${error.message} fields=${error.fields.join(",")}`;
    case "server":
      return `status=${String(error.status)}`;
    case "authExpired":
    case "notFound":
    case "network":
      return "";
  }
}

export function errorDiagnostics(error: unknown): string {
  const lines = [`time=${new Date().toISOString()}`];
  if (isGitHubError(error)) {
    lines.push(`kind=${error.kind}`, describe(error));
  } else if (error instanceof Error) {
    // Arbitrary messages may embed private content.
    lines.push(`error=${error.name}`);
  } else {
    lines.push(`error=${typeof error}`);
  }
  return lines.filter(Boolean).join("\n");
}
