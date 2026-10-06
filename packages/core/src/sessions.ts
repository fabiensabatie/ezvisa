import { randomBytes } from "node:crypto";
import type { Db } from "@ezvisa/db";
import { authenticateToken } from "./auth.js";
import type { Actor } from "./context.js";
import { DomainError } from "./errors.js";
import { parsePermissions } from "./permissions.js";

export const SESSION_COOKIE = "ezv_session";
export const SESSION_DAYS = 30;

/**
 * Exchanges an access token for a dashboard session. The browser only ever holds
 * the session id, in an httpOnly cookie; the token itself is not kept.
 */
export async function createSession(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ id: string; expiresAt: Date; actor: Actor }> {
  const actor = await authenticateToken(db, token, now);
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { id, tokenId: actor.tokenId, expiresAt } });
  return { id, expiresAt, actor };
}

/** Resolves a session id to the acting employee, rechecking the token every time. */
export async function authenticateSession(
  db: Db,
  sessionId: string,
  now = new Date(),
): Promise<Actor> {
  const invalid = new DomainError("UNAUTHORIZED", "Your session has ended. Sign in again.");
  if (!sessionId) throw invalid;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { token: { include: { employee: { include: { role: true } } } } },
  });
  if (!session || session.expiresAt <= now) throw invalid;
  const { token } = session;
  if (token.revokedAt || (token.expiresAt && token.expiresAt <= now) || !token.employee.active) {
    throw invalid;
  }
  return {
    employeeId: token.employee.id,
    name: token.employee.name,
    roleName: token.employee.role.name,
    kind: token.employee.kind,
    permissions: parsePermissions(token.employee.role.permissions),
    tokenId: token.id,
  };
}

export async function endSession(db: Db, sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } });
}
