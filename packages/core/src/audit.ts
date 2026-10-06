import type { Prisma } from "@ezvisa/db";
import type { Context, Tx } from "./context.js";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

/** Plain JSON copy: Dates become ISO strings, BigInts become strings. */
export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

/** Records one audit row. Call it inside the same transaction as the change. */
export async function audit(tx: Tx, ctx: Context, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: ctx.actor.employeeId,
      via: ctx.via,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  });
}
