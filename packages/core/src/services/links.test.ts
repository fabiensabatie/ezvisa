import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestActor,
  createTestContext,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "../testing.js";
import { createLink, deleteLink, listLinks, markLinkChecked, updateLink } from "./links.js";

const url = testDatabaseUrl();
const DAY_MS = 86_400_000;

describe.skipIf(!url)("links service", () => {
  let db: Db;
  const as = async (role: string, now?: Date) =>
    createTestContext(db, (await createTestActor(db, role)).actor, { via: "DASHBOARD", now });

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(() => resetDatabase(db));

  it("adds, finds, pins, checks and deletes a link, auditing each write", async () => {
    const owner = await as("Owner");
    const created = await createLink(owner, {
      name: "Thai e-Visa",
      url: "https://www.thaievisa.go.th",
      category: "IMMIGRATION",
      note: "Clients apply here before they fly.",
      audience: "CLIENT",
    });
    expect(created).toMatchObject({
      pinned: false,
      needsLogin: false,
      checkedAt: TEST_NOW.toISOString(),
      checkedBy: "Owner tester",
      needsCheck: false,
    });

    await createLink(owner, {
      name: "e-WorkPermit",
      url: "https://workpermit.doe.go.th",
      category: "WORK_PERMITS",
    });
    expect((await listLinks(owner, { search: "EVISA" })).items.map((l) => l.name)).toEqual([
      "Thai e-Visa",
    ]);
    expect((await listLinks(owner, { category: "WORK_PERMITS" })).items.map((l) => l.name)).toEqual(
      ["e-WorkPermit"],
    );

    const pinned = await updateLink(owner, { linkId: created.id, pinned: true, note: null });
    expect(pinned).toMatchObject({ pinned: true, note: null });

    const later = await as("Validator", new Date(TEST_NOW.getTime() + 120 * DAY_MS));
    expect((await listLinks(later, {})).items.every((l) => l.needsCheck)).toBe(true);
    const checked = await markLinkChecked(later, { linkId: created.id });
    expect(checked).toMatchObject({ needsCheck: false, checkedBy: "Validator tester" });

    await deleteLink(owner, { linkId: created.id });
    const actions = (await db.auditLog.findMany({ where: { entityId: created.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["link.created", "link.updated", "link.checked", "link.deleted"]);
  });

  it("lets agents read the list but never change it", async () => {
    const owner = await as("Owner");
    const link = await createLink(owner, {
      name: "Immigration Bureau",
      url: "https://www.immigration.go.th",
      category: "IMMIGRATION",
    });
    const assistant = await as("Assistant (MCP)");
    expect((await listLinks(assistant, {})).items).toHaveLength(1);
    await expect(updateLink(assistant, { linkId: link.id, pinned: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createLink(assistant, { name: "x", url: "https://example.com", category: "OTHER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps deleting for full access and rejects addresses that are not web pages", async () => {
    const owner = await as("Owner");
    const link = await createLink(owner, {
      name: "Revenue Department",
      url: "https://www.rd.go.th",
      category: "INSURANCE_MONEY",
    });
    const runner = await as("Runner");
    await expect(deleteLink(runner, { linkId: link.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createLink(owner, { name: "Bad", url: "javascript:alert(1)", category: "OTHER" }),
    ).rejects.toThrow();
  });
});
