import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticateToken } from "../auth.js";
import type { Context } from "../context.js";
import {
  createTestActor,
  createTestContext,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "../testing.js";
import { getPublicSettings, updateSettings } from "./settings.js";
import { createEmployee, createToken, deactivateEmployee, revokeToken } from "./team.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("tokens and settings", () => {
  let db: Db;
  let owner: Context;

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    owner = createTestContext(db, (await createTestActor(db, "Owner")).actor, {
      via: "DASHBOARD",
    });
  });

  async function validatorRole() {
    return db.role.findUniqueOrThrow({ where: { name: "Validator" } });
  }

  it("creates a working token, shown once and never written to the audit log", async () => {
    const ploy = await createEmployee(owner, {
      name: "Ploy S.",
      email: "ploy@test.local",
      roleId: (await validatorRole()).id,
    });
    const created = await createToken(owner, {
      employeeId: ploy.id,
      label: "Ploy phone",
      expiresInDays: 30,
    });
    expect(created.secret).toMatch(/^ezv_live_[0-9A-Za-z]{43}$/);
    expect(created.token).toBe(`ezv_live_••••${created.secret.slice(-4)}`);
    expect(created.expiresAt).toBe(new Date(TEST_NOW.getTime() + 30 * 86_400_000).toISOString());

    const actor = await authenticateToken(db, created.secret, TEST_NOW);
    expect(actor).toMatchObject({ name: "Ploy S.", roleName: "Validator" });

    const logs = await db.auditLog.findMany({ where: { action: "token.created" } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]?.after)).not.toContain(created.secret);

    await revokeToken(owner, { tokenId: created.id });
    await expect(authenticateToken(db, created.secret, TEST_NOW)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("only lets a person with full team access create tokens, for active employees", async () => {
    const validator = createTestContext(db, (await createTestActor(db, "Validator")).actor);
    await expect(
      createToken(validator, { employeeId: validator.actor.employeeId, label: "mine" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ploy = await createEmployee(owner, {
      name: "Ploy S.",
      roleId: (await validatorRole()).id,
    });
    await deactivateEmployee(owner, { employeeId: ploy.id });
    await expect(
      createToken(owner, { employeeId: ploy.id, label: "old phone" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves the agency colour and name for everyone, audited", async () => {
    expect(await getPublicSettings(owner)).toEqual({ accent: "#EC5F9E", agentName: "Namtarn" });
    const saved = await updateSettings(owner, { accent: "#9a7be6", agentName: "Namtarn K." });
    expect(saved).toEqual({ accent: "#9A7BE6", agentName: "Namtarn K." });
    expect(await getPublicSettings(owner)).toEqual(saved);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "settings.updated" } });
    expect(log.before).toMatchObject({ accent: "#EC5F9E" });

    await expect(updateSettings(owner, { accent: "pink" })).rejects.toThrow();
    const validator = createTestContext(db, (await createTestActor(db, "Validator")).actor);
    await expect(updateSettings(validator, { accent: "#000000" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
