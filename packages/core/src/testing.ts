import type { Db } from "@ezvisa/db";
import { ALL_TABLES } from "@ezvisa/db/testing";
import type { Actor, Context, Via } from "./context.js";
import { loadRootEnv } from "./env.js";
import { parsePermissions } from "./permissions.js";
import { seedBase } from "./seed-base.js";
import { createTemplate, publishTemplateVersion } from "./services/templates.js";
import { MemoryStorage, type Storage } from "./storage.js";
import { generateToken, hashToken, tokenLast4 } from "./tokens.js";

/** A fixed clock for tests: 1 October 2026, 10:00 in Bangkok. */
export const TEST_NOW = new Date("2026-10-01T03:00:00.000Z");

/**
 * The dedicated test database. Tests never use DATABASE_URL, because they wipe tables.
 * Undefined when not configured, so database tests can be skipped.
 */
export function testDatabaseUrl(): string | undefined {
  loadRootEnv();
  return process.env.TEST_DATABASE_URL?.trim() || undefined;
}

/** Empties every table and reseeds roles, rules and settings. */
export async function resetDatabase(db: Db): Promise<void> {
  const tables = ALL_TABLES.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  await seedBase(db, { email: "owner@test.local", name: "Namtarn" });
}

/** Creates an employee with the given seeded role and a token for them. */
export async function createTestActor(
  db: Db,
  roleName: string,
  options: { kind?: "HUMAN" | "ASSISTANT"; name?: string } = {},
): Promise<{ actor: Actor; token: string }> {
  const role = await db.role.findUniqueOrThrow({ where: { name: roleName } });
  const kind = options.kind ?? (roleName === "Assistant (MCP)" ? "ASSISTANT" : "HUMAN");
  const employee = await db.employee.create({
    data: { name: options.name ?? `${roleName} tester`, roleId: role.id, kind },
  });
  const token = generateToken();
  const row = await db.apiToken.create({
    data: {
      employeeId: employee.id,
      label: "test",
      hash: hashToken(token),
      last4: tokenLast4(token),
    },
  });
  return {
    token,
    actor: {
      employeeId: employee.id,
      name: employee.name,
      roleName: role.name,
      kind,
      permissions: parsePermissions(role.permissions),
      tokenId: row.id,
    },
  };
}

/** A small retirement-extension template, created and published. */
export async function publishSampleTemplate(ctx: Context, slug = "retirement-extension") {
  await createTemplate(ctx, {
    slug,
    name: "Retirement extension",
    deadlineKind: "STAY_ENDS",
    knownFailures: ["Photo background not white"],
    items: [
      { label: "Passport with all stamped pages" },
      { label: "Bank letter confirming the balance", rules: { maxAgeDays: 7 } },
      { label: "Two photos, 4 × 6 cm" },
      { label: "Map to the residence", required: false },
    ],
  });
  return publishTemplateVersion(ctx, { template: slug });
}

export function createTestContext(
  db: Db,
  actor: Actor,
  options: { storage?: Storage | null; now?: Date; via?: Via } = {},
): Context {
  return {
    actor,
    db,
    via: options.via ?? "MCP",
    storage: options.storage === undefined ? new MemoryStorage() : options.storage,
    now: () => options.now ?? TEST_NOW,
  };
}
