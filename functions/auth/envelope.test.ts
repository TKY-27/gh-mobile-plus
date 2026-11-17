import { describe, expect, test } from "vitest";
import { importCookieKeys, open, seal, type CookieKeys } from "./envelope";
import { KEY_ONE, KEY_TWO } from "./testing";

const NAME = "__Host-ghm_acct_1";
const PLAINTEXT = '{"secret":"value"}';

async function keys(map: Record<string, string>, activeKid: string): Promise<CookieKeys> {
  const imported = await importCookieKeys(JSON.stringify(map), activeKid);
  if (imported === null) throw new Error("test keys rejected");
  return imported;
}

function flipCharacter(text: string, index: number): string {
  const replacement = text[index] === "A" ? "B" : "A";
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
}

describe("cookie envelope", () => {
  test("round-trips with the kid.iv.ciphertext format", async () => {
    const k1 = await keys({ k1: KEY_ONE }, "k1");
    const envelope = await seal(k1, NAME, PLAINTEXT);
    expect(envelope).toMatch(/^k1\.[\w-]{16}\.[\w-]+$/);
    expect(envelope).not.toContain("secret");
    expect(await open(k1, NAME, envelope)).toBe(PLAINTEXT);
  });

  test("uses a fresh IV for every seal", async () => {
    const k1 = await keys({ k1: KEY_ONE }, "k1");
    expect(await seal(k1, NAME, PLAINTEXT)).not.toBe(await seal(k1, NAME, PLAINTEXT));
  });

  test("rejects tampered ciphertext, IV and malformed envelopes", async () => {
    const k1 = await keys({ k1: KEY_ONE }, "k1");
    const envelope = await seal(k1, NAME, PLAINTEXT);
    const [kid = "", iv = "", ciphertext = ""] = envelope.split(".");
    for (const candidate of [
      `${kid}.${iv}.${flipCharacter(ciphertext, 3)}`,
      `${kid}.${flipCharacter(iv, 2)}.${ciphertext}`,
      `${kid}.${iv}.${ciphertext.slice(0, -2)}`,
      `${kid}.${iv}`,
      `${envelope}.extra`,
      `k9.${iv}.${ciphertext}`,
      `${kid}.${iv.slice(0, -1)}.${ciphertext}`,
      `${kid}.${iv}.${ciphertext}+`,
      "",
    ]) {
      expect(await open(k1, NAME, candidate)).toBeNull();
    }
  });

  test("binds the cookie name as additional authenticated data", async () => {
    const k1 = await keys({ k1: KEY_ONE }, "k1");
    const envelope = await seal(k1, NAME, PLAINTEXT);
    expect(await open(k1, "__Host-ghm_acct_2", envelope)).toBeNull();
  });

  test("decrypts old kids after rotation and seals with the active kid", async () => {
    const before = await keys({ k1: KEY_ONE }, "k1");
    const after = await keys({ k1: KEY_ONE, k2: KEY_TWO }, "k2");
    const old = await seal(before, NAME, PLAINTEXT);
    expect(await open(after, NAME, old)).toBe(PLAINTEXT);
    const fresh = await seal(after, NAME, PLAINTEXT);
    expect(fresh.startsWith("k2.")).toBe(true);
    expect(await open(before, NAME, fresh)).toBeNull();
    const retired = await keys({ k2: KEY_TWO }, "k2");
    expect(await open(retired, NAME, old)).toBeNull();
  });

  test("rejects invalid key configuration", async () => {
    const shortKey = btoa("x".repeat(16));
    for (const [json, activeKid] of [
      ["not json", "k1"],
      ["[]", "k1"],
      [JSON.stringify({ k1: KEY_ONE }), "k2"],
      [JSON.stringify({ k1: shortKey }), "k1"],
      [JSON.stringify({ k1: "not base64!" }), "k1"],
      [JSON.stringify({ k1: 42 }), "k1"],
      [JSON.stringify({ "k.1": KEY_ONE }), "k.1"],
    ] as const) {
      expect(await importCookieKeys(json, activeKid)).toBeNull();
    }
  });
});
