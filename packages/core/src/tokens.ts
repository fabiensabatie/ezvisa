import { createHash, randomInt } from "node:crypto";

export const TOKEN_PREFIX = "ezv_live_";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 43 base62 characters carry just over 256 bits of entropy. */
const TOKEN_BODY_LENGTH = 43;

/** Generates a new access token. Show it once, store only its hash. */
export function generateToken(): string {
  let body = "";
  for (let i = 0; i < TOKEN_BODY_LENGTH; i++) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return TOKEN_PREFIX + body;
}

/** SHA-256 hex digest, the only form of a token kept in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}

/** Masked form for display, e.g. "ezv_live_••••7c21". */
export function maskToken(last4: string): string {
  return `${TOKEN_PREFIX}••••${last4}`;
}

/** Cheap shape check before hitting the database. */
export function looksLikeToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length >= TOKEN_PREFIX.length + 20;
}
