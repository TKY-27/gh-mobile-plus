const CHALLENGE_BYTES = 32;
const USER_ID_BYTES = 16;
const PROMPT_TIMEOUT_MS = 60_000;
const ES256 = -7;
const RS256 = -257;
const APP_NAME = "GH Mobile+";

let verifiedCredentialId: string | null = null;

let lastActiveAt = 0;

export function recordLockActivity(): void {
  lastActiveAt = Date.now();
}

export function wasVerifiedThisSession(credentialId: string, idleMs: number): boolean {
  return verifiedCredentialId === credentialId && Date.now() - lastActiveAt < idleMs;
}

export function setSessionVerification(credentialId: string | null): void {
  verifiedCredentialId = credentialId;
  if (credentialId !== null) recordLockActivity();
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function isAppLockAvailable(): Promise<boolean> {
  if (!("PublicKeyCredential" in window)) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

/** Privacy screen only: nothing is verified server-side. */
export async function createLockCredential(): Promise<string> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(CHALLENGE_BYTES),
      rp: { id: location.hostname, name: APP_NAME },
      user: { id: randomBytes(USER_ID_BYTES), name: APP_NAME, displayName: APP_NAME },
      pubKeyCredParams: [
        { type: "public-key", alg: ES256 },
        { type: "public-key", alg: RS256 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "discouraged",
        userVerification: "required",
      },
      timeout: PROMPT_TIMEOUT_MS,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("No platform credential was created");
  }
  // Enrollment already confirms user verification.
  setSessionVerification(credential.id);
  return credential.id;
}

export async function verifyLockCredential(credentialId: string): Promise<void> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(CHALLENGE_BYTES),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromBase64Url(credentialId) }],
      userVerification: "required",
      timeout: PROMPT_TIMEOUT_MS,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Unlock was not confirmed");
  }
}
