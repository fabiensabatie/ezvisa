import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashToken,
  looksLikeToken,
  maskToken,
  TOKEN_PREFIX,
  tokenLast4,
} from "./tokens.js";

describe("tokens", () => {
  it("generates prefixed base62 tokens of a fixed length", () => {
    const token = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(TOKEN_PREFIX.length + 43);
    expect(token.slice(TOKEN_PREFIX.length)).toMatch(/^[0-9A-Za-z]+$/);
    expect(looksLikeToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
  });

  it("hashes deterministically to SHA-256 hex", () => {
    expect(hashToken("ezv_live_example")).toBe(hashToken("ezv_live_example"));
    expect(hashToken("ezv_live_example")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("ezv_live_a")).not.toBe(hashToken("ezv_live_b"));
  });

  it("masks with the last four characters only", () => {
    const token = generateToken();
    const last4 = tokenLast4(token);
    expect(token.endsWith(last4)).toBe(true);
    expect(maskToken(last4)).toBe(`${TOKEN_PREFIX}••••${last4}`);
  });

  it("rejects values that are obviously not tokens", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("Bearer abc")).toBe(false);
    expect(looksLikeToken(`${TOKEN_PREFIX}short`)).toBe(false);
  });
});
