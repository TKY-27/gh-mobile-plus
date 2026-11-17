import { isRecord } from "./http";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KID_PATTERN = /^[\w-]+$/;
const BASE64URL_PATTERN = /^[\w-]+$/;
const AES_GCM = "AES-GCM";

export interface CookieKeys {
  activeKid: string;
  activeKey: CryptoKey;
  byKid: ReadonlyMap<string, CryptoKey>;
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  // atob rejects lengths of 1 mod 4.
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeKeyMaterial(encoded: unknown): Uint8Array | null {
  if (typeof encoded !== "string") return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "InvalidCharacterError") return null;
    throw error;
  }
}

function parseKeyMap(keysJson: string): unknown {
  try {
    return JSON.parse(keysJson);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function importCookieKeys(
  keysJson: string,
  activeKid: string,
): Promise<CookieKeys | null> {
  const keyMap = parseKeyMap(keysJson);
  if (!isRecord(keyMap)) return null;
  const byKid = new Map<string, CryptoKey>();
  for (const [kid, encoded] of Object.entries(keyMap)) {
    const material = decodeKeyMaterial(encoded);
    if (!KID_PATTERN.test(kid) || material === null) return null;
    byKid.set(
      kid,
      await crypto.subtle.importKey("raw", material, AES_GCM, false, ["encrypt", "decrypt"]),
    );
  }
  const activeKey = byKid.get(activeKid);
  return activeKey === undefined ? null : { activeKid, activeKey, byKid };
}

export async function seal(
  keys: CookieKeys,
  cookieName: string,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_GCM, iv, additionalData: new TextEncoder().encode(cookieName) },
    keys.activeKey,
    new TextEncoder().encode(plaintext),
  );
  return `${keys.activeKid}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function open(
  keys: CookieKeys,
  cookieName: string,
  envelope: string,
): Promise<string | null> {
  const [kid, encodedIv, encodedCiphertext, ...rest] = envelope.split(".");
  if (kid === undefined || encodedIv === undefined || encodedCiphertext === undefined) return null;
  const key = keys.byKid.get(kid);
  const iv = fromBase64Url(encodedIv);
  const ciphertext = fromBase64Url(encodedCiphertext);
  if (rest.length > 0 || key === undefined || iv?.length !== IV_BYTES || ciphertext === null) {
    return null;
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: AES_GCM, iv, additionalData: new TextEncoder().encode(cookieName) },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    // Authentication failure: tampered, truncated or moved cookie.
    if (error instanceof DOMException && error.name === "OperationError") return null;
    throw error;
  }
}
