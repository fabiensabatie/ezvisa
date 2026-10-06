import type { Db, Prisma } from "@ezvisa/db";
import { DomainError } from "./errors.js";
import { hasLevel, type Level, type Permissions, type Resource } from "./permissions.js";
import type { Storage } from "./storage.js";

export type Via = "DASHBOARD" | "MCP" | "SYSTEM";

/** Who is acting. Built from a token for both the dashboard and MCP. */
export type Actor = {
  employeeId: string;
  name: string;
  roleName: string;
  kind: "HUMAN" | "ASSISTANT";
  permissions: Permissions;
  tokenId: string;
};

/** Passed to every domain service. */
export type Context = {
  actor: Actor;
  via: Via;
  db: Db;
  /** Null when no bucket is configured; document operations then fail clearly. */
  storage: Storage | null;
  now: () => Date;
};

/** A Prisma client usable inside or outside a transaction. */
export type Tx = Prisma.TransactionClient | Db;

const LEVEL_VERBS: Record<Level, string> = {
  none: "access",
  view: "view",
  edit: "change",
  full: "delete or administer",
};

/** Throws FORBIDDEN unless the actor's role reaches `level` on `resource`. */
export function requireLevel(ctx: Context, resource: Resource, level: Level): void {
  if (!hasLevel(ctx.actor.permissions, resource, level)) {
    throw new DomainError(
      "FORBIDDEN",
      `The ${ctx.actor.roleName} role cannot ${LEVEL_VERBS[level]} ${resource}.`,
    );
  }
}

/** Throws FORBIDDEN when the actor is an assistant. */
export function requireHuman(ctx: Context, action: string): void {
  if (ctx.actor.kind !== "HUMAN") {
    throw new DomainError("FORBIDDEN", `Only a person can ${action}. Ask a team member to do it.`);
  }
}

export function requireStorage(ctx: Context): Storage {
  if (!ctx.storage) {
    throw new DomainError("CONFLICT", "File storage is not configured on this server.");
  }
  return ctx.storage;
}
