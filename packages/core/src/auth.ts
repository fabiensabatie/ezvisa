import type { Db } from "@ezvisa/db";
import type { Actor } from "./context.js";
import { DomainError } from "./errors.js";
import { parsePermissions } from "./permissions.js";
import { ACCESS_TOKEN_PREFIX, hashToken, looksLikeToken } from "./tokens.js";

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

/**
 * Resolves an OAuth access token, issued to an MCP connector, to the employee who approved
 * it. The grant behind it (an ApiToken) is checked on every request, so revoking the grant
 * from the dashboard cuts the connector off at once.
 */
export async function authenticateAccessToken(
  db: Db,
  token: string,
  now = new Date(),
): Promise<Actor> {
  const invalid = new DomainError(
    "UNAUTHORIZED",
    "The access token is missing, invalid, expired or revoked.",
  );
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) throw invalid;

  const row = await db.oAuthAccessToken.findUnique({
    where: { hash: hashToken(token) },
    include: { token: { include: { employee: { include: { role: true } } } } },
  });
  if (!row || row.expiresAt <= now) throw invalid;
  const grant = row.token;
  if (grant.revokedAt || !grant.employee.active) throw invalid;
  if (grant.expiresAt && grant.expiresAt <= now) throw invalid;

  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.apiToken.update({ where: { id: grant.id }, data: { lastUsedAt: now } });
  }

  return {
    employeeId: grant.employee.id,
    name: grant.employee.name,
    roleName: grant.employee.role.name,
    kind: grant.employee.kind,
    permissions: parsePermissions(grant.employee.role.permissions),
    tokenId: grant.id,
  };
}

/** Accepts either a personal access token or an OAuth access token, for /mcp. */
export function authenticateBearer(db: Db, token: string, now = new Date()): Promise<Actor> {
  return token.startsWith(ACCESS_TOKEN_PREFIX)
    ? authenticateAccessToken(db, token, now)
    : authenticateToken(db, token, now);
}

/** Extracts the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
