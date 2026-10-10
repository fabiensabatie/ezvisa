import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestActor, createTestContext, resetDatabase, testDatabaseUrl } from "../testing.js";
import { createClient, deleteClient, getClient, listClients, updateClient } from "./clients.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("clients service", () => {
  let db: Db;
  const as = async (role: string) => createTestContext(db, (await createTestActor(db, role)).actor);

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(() => resetDatabase(db));

  it("creates, finds, updates and soft-deletes a client, auditing each write", async () => {
    const ctx = await as("Owner");
    const created = await createClient(ctx, {
      fullName: "Margaret Ellis",
      nationality: "gb",
      email: "Margaret@Example.com",
      stayUntil: "2026-10-14",
      consentGiven: true,
    });
    expect(created).toMatchObject({
      nationality: "GB",
      email: "margaret@example.com",
      stayUntil: "2026-10-14",
    });
    expect(created.consentAt).not.toBeNull();

    const found = await listClients(ctx, { search: "ellis" });
    expect(found.items.map((c) => c.id)).toEqual([created.id]);

    const updated = await updateClient(ctx, {
      clientId: created.id,
      stayUntil: "2027-10-14",
      email: null,
    });
    expect(updated).toMatchObject({ stayUntil: "2027-10-14", email: null });

    await deleteClient(ctx, { clientId: created.id });
    expect((await listClients(ctx, {})).items).toHaveLength(0);

    const actions = (await db.auditLog.findMany({ where: { entityId: created.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["client.created", "client.updated", "client.deleted"]);
  });

  it("filters clients whose deadlines fall within a window", async () => {
    const ctx = await as("Owner");
    await createClient(ctx, { fullName: "Soon", nationality: "FR", stayUntil: "2026-10-10" });
    await createClient(ctx, { fullName: "Report", nationality: "DE", nextReportDue: "2026-10-03" });
    await createClient(ctx, { fullName: "Later", nationality: "US", stayUntil: "2027-03-01" });
    const soon = await listClients(ctx, { expiringWithinDays: 14 });
    expect(soon.items.map((c) => c.fullName)).toEqual(["Report", "Soon"]);
  });

  it("paginates with a cursor", async () => {
    const ctx = await as("Owner");
    for (const name of ["Ana", "Ben", "Chen", "Dee", "Eve"]) {
      await createClient(ctx, { fullName: name, nationality: "TH" });
    }
    const first = await listClients(ctx, { limit: 2 });
    const second = await listClients(ctx, { limit: 2, cursor: first.nextCursor ?? undefined });
    const third = await listClients(ctx, { limit: 2, cursor: second.nextCursor ?? undefined });
    expect([...first.items, ...second.items, ...third.items].map((c) => c.fullName)).toEqual([
      "Ana",
      "Ben",
      "Chen",
      "Dee",
      "Eve",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("shows deadlines with days left on the client record", async () => {
    const ctx = await as("Validator");
    const client = await createClient(ctx, {
      fullName: "Tom Richards",
      nationality: "AU",
      stayUntil: "2026-10-06",
      nextReportDue: "2026-10-03",
    });
    const record = await getClient(ctx, { clientId: client.id });
    expect(record.deadlines).toEqual([
      { kind: "STAY_ENDS", date: "2026-10-06", daysLeft: 5 },
      { kind: "REPORT_DUE", date: "2026-10-03", daysLeft: 2 },
    ]);
  });

  it("enforces role permissions", async () => {
    const runner = await as("Runner");
    await expect(createClient(runner, { fullName: "X", nationality: "TH" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const validator = await as("Validator");
    const client = await createClient(validator, { fullName: "Y", nationality: "TH" });
    await expect(deleteClient(validator, { clientId: client.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
