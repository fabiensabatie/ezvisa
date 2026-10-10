import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticateToken, bearerToken } from "./auth.js";
import { createTestActor, resetDatabase, testDatabaseUrl } from "./testing.js";

describe("bearerToken", () => {
  it("extracts the token from an Authorization header", () => {
    expect(bearerToken("Bearer ezv_live_abc")).toBe("ezv_live_abc");
    expect(bearerToken("bearer   ezv_live_abc  ")).toBe("ezv_live_abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

const url = testDatabaseUrl();

describe.skipIf(!url)("authenticateToken", () => {
  let db: Db;

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(() => resetDatabase(db));

  it("resolves a valid token to the employee and role, and records the use", async () => {
    const { token, actor } = await createTestActor(db, "Validator", { name: "Ploy S." });
    const resolved = await authenticateToken(db, token);
    expect(resolved).toMatchObject({ name: "Ploy S.", roleName: "Validator", kind: "HUMAN" });
    expect(resolved.permissions.approvePacks).toBe(true);
    const row = await db.apiToken.findUniqueOrThrow({ where: { id: actor.tokenId } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("refuses unknown, revoked, expired and deactivated tokens", async () => {
    await expect(authenticateToken(db, "ezv_live_unknownunknownunknown")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const revoked = await createTestActor(db, "Runner");
    await db.apiToken.update({
      where: { id: revoked.actor.tokenId },
      data: { revokedAt: new Date() },
    });
    await expect(authenticateToken(db, revoked.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const expired = await createTestActor(db, "Runner");
    await db.apiToken.update({
      where: { id: expired.actor.tokenId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(authenticateToken(db, expired.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const inactive = await createTestActor(db, "Runner");
    await db.employee.update({ where: { id: inactive.actor.employeeId }, data: { active: false } });
    await expect(authenticateToken(db, inactive.token)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
