import type { Db } from "@ezvisa/db";
import type { Actor } from "./context.js";
import { DomainError } from "./errors.js";
import { parsePermissions } from "./permissions.js";
import { hashToken, looksLikeToken } from "./tokens.js";

const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Resolves a bearer token to the acting employee. One indexed lookup per request,
 * with no cache, so a revoked token stops working on its very next request.
 */
export async function authenticateToken(db: Db, token: string, now = new Date()): Promise<Actor> {
  const invalid = new DomainError(
    "UNAUTHORIZED",
    "The access token is missing, invalid or revoked.",
  );
  if (!looksLikeToken(token)) throw invalid;

  const row = await db.apiToken.findUnique({
    where: { hash: hashToken(token) },
    include: { employee: { include: { role: true } } },
  });
  if (!row || row.revokedAt || !row.employee.active) throw invalid;
  if (row.expiresAt && row.expiresAt <= now) throw invalid;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }

  return {
    employeeId: row.employee.id,
    name: row.employee.name,
    roleName: row.employee.role.name,
    kind: row.employee.kind,
    permissions: parsePermissions(row.employee.role.permissions),
    tokenId: row.id,
  };
}

/** Extracts the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
