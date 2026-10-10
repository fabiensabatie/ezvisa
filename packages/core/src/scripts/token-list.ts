import { parseArgs } from "node:util";
import { maskToken } from "../tokens.js";
import { findEmployee, runWithDb } from "./cli.js";

// Usage: pnpm token:list [--employee <email|id>]

const { values } = parseArgs({ options: { employee: { type: "string" } } });

await runWithDb(async (db) => {
  const employeeId = values.employee ? (await findEmployee(db, values.employee)).id : undefined;
  const tokens = await db.apiToken.findMany({
    where: employeeId ? { employeeId } : {},
    include: { employee: true },
    orderBy: { createdAt: "asc" },
  });

  if (tokens.length === 0) {
    console.log("No tokens.");
    return;
  }

  console.table(
    tokens.map((t) => ({
      id: t.id,
      employee: t.employee.name,
      label: t.label,
      token: maskToken(t.last4),
      created: t.createdAt.toISOString().slice(0, 10),
      lastUsed: t.lastUsedAt?.toISOString().slice(0, 16) ?? "never",
      status: t.revokedAt
        ? "revoked"
        : t.expiresAt && t.expiresAt < new Date()
          ? "expired"
          : "active",
    })),
  );
});
