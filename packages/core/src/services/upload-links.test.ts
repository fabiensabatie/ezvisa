import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import { MemoryStorage } from "../storage.js";
import {
  createTestActor,
  createTestContext,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "../testing.js";
import { closeCase, createCase, getCase, moveCaseStage, updateCaseItem } from "./cases.js";
import { createClient } from "./clients.js";
import { createTemplate, publishTemplateVersion } from "./templates.js";
import {
  acceptPrivacyNotice,
  type ClientContext,
  clientFileLink,
  confirmClientUpload,
  createClientUpload,
  createUploadLink,
  listClientFiles,
  removeClientFile,
  revokeUploadLink,
  viewUploadPage,
} from "./upload-links.js";

const url = testDatabaseUrl();
const DAY = 86_400_000;

describe.skipIf(!url)("client upload links", () => {
  let db: Db;
  let staff: Context;
  let visitor: ClientContext;
  let clock: Date;
  const storage = new MemoryStorage();

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    storage.objects.clear();
    clock = TEST_NOW;
    const actor = (await createTestActor(db, "Validator", { name: "Ploy S." })).actor;
    staff = {
      ...createTestContext(db, actor, { storage, via: "DASHBOARD" }),
      now: () => clock,
      appUrl: "https://ezvisa.example/",
    };
    visitor = { db, storage, now: () => clock };
  });

  async function openCase() {
    const owner = createTestContext(db, (await createTestActor(db, "Owner")).actor, { storage });
    await createTemplate(owner, {
      slug: "non-b",
      name: "Non-B work extension",
      items: [
        { label: "Passport", description: "Every page with a stamp" },
        { label: "Two photos", required: false },
        { label: "TM.7 application", kind: "FORM" },
      ],
    });
    await publishTemplateVersion(owner, { template: "non-b" });
    const client = await createClient(owner, {
      fullName: "Jo Maupas",
      nationality: "FR",
      passportNo: "FR123456",
    });
    return createCase(owner, { clientId: client.id, template: "non-b" });
  }

  const secretOf = (link: { url: string }) => link.url.split("#")[1] ?? "";

  it("shares the client's part of the checklist, and only that", async () => {
    const kase = await openCase();
    const link = await createUploadLink(staff, { case: kase.number });
    expect(link.url).toMatch(/^https:\/\/ezvisa\.example\/upload#[\w-]{43}$/);
    expect(link.items).toEqual(["Passport", "Two photos"]);
    expect(link.expiresAt).toBe(new Date(TEST_NOW.getTime() + 14 * DAY).toISOString());
    expect(link.message).toContain(
      "Hi Jo, please upload the documents for your Non-B work extension",
    );
    expect(link.message).toContain("works until 15 Oct");

    const page = await viewUploadPage(visitor, { secret: secretOf(link) });
    expect(page).toMatchObject({ firstName: "Jo", caseType: "Non-B work extension" });
    expect(page.consentGiven).toBe(false);
    expect(page.items.map((i) => [i.label, i.description, i.state])).toEqual([
      ["Passport", "Every page with a stamp", "needed"],
      ["Two photos", null, "needed"],
    ]);
    // Nothing else about the client or the case leaks onto the page.
    expect(JSON.stringify(page)).not.toMatch(/Maupas|FR123456|EZ-/);

    const detail = await getCase(staff, { case: kase.number });
    expect(detail.uploadLink).toMatchObject({ uploads: 0, expiresAt: link.expiresAt });
    expect(detail.items.map((i) => i.clientUpload)).toEqual([true, true, false]);
  });

  it("takes consent first, then files each upload under its item for the team to check", async () => {
    const kase = await openCase();
    const secret = secretOf(await createUploadLink(staff, { case: kase.number }));
    const passport = kase.items[0]?.id ?? "";
    const tm7 = kase.items[2]?.id ?? "";
    const file = { secret, filename: "passport.jpg", mimeType: "image/jpeg", sizeBytes: 4 };

    await expect(createClientUpload(visitor, { ...file, itemId: passport })).rejects.toMatchObject({
      code: "GUARD_FAILED",
    });
    expect((await acceptPrivacyNotice(visitor, { secret })).consentGiven).toBe(true);
    await expect(createClientUpload(visitor, { ...file, itemId: tm7 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const upload = await createClientUpload(visitor, { ...file, itemId: passport });
    await storage.put(upload.uploadKey, new Uint8Array([1, 2, 3, 4]), "image/jpeg");
    const page = await confirmClientUpload(visitor, {
      secret,
      itemId: passport,
      uploadKey: upload.uploadKey,
      filename: "passport.jpg",
      mimeType: "image/jpeg",
    });
    expect(page.items[0]).toMatchObject({ state: "received", files: 1 });

    const detail = await getCase(staff, { case: kase.number });
    expect(detail.items[0]?.status).toBe("RECEIVED");
    expect(detail.documents[0]).toMatchObject({ filename: "passport.jpg", caseItemId: passport });
    expect(detail.uploadLink?.uploads).toBe(1);

    const byClient = await db.auditLog.findMany({
      where: { via: "CLIENT" },
      orderBy: { id: "asc" },
    });
    expect(byClient.map((a) => [a.action, a.actorId])).toEqual([
      ["client.consent_given", null],
      ["document.uploaded", null],
    ]);

    // A flagged item can be sent again; it goes back to RECEIVED.
    await updateCaseItem(staff, {
      case: kase.number,
      itemId: passport,
      status: "FLAGGED",
      note: "Blurry",
    });
    const again = await createClientUpload(visitor, { ...file, itemId: passport });
    await storage.put(again.uploadKey, new Uint8Array([5, 6, 7, 8]), "image/jpeg");
    const after = await confirmClientUpload(visitor, {
      secret,
      itemId: passport,
      uploadKey: again.uploadKey,
      filename: "passport-2.jpg",
      mimeType: "image/jpeg",
    });
    expect(after.items[0]).toMatchObject({ state: "received", files: 2 });

    // An upload key pointing at another client is refused.
    await expect(
      confirmClientUpload(visitor, {
        secret,
        itemId: passport,
        uploadKey: upload.uploadKey.replace(/^clients\/[0-9a-f-]{36}/, `clients/${kase.id}`),
        filename: "x.jpg",
        mimeType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stops working when replaced, revoked, expired or the case is closed", async () => {
    const kase = await openCase();
    const first = secretOf(await createUploadLink(staff, { case: kase.number }));
    const second = secretOf(await createUploadLink(staff, { case: kase.number, expiresInDays: 3 }));
    await expect(viewUploadPage(visitor, { secret: first })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await viewUploadPage(visitor, { secret: second })).toBeTruthy();

    clock = new Date(TEST_NOW.getTime() + 3 * DAY + 1);
    await expect(viewUploadPage(visitor, { secret: second })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    clock = TEST_NOW;
    const third = secretOf(await createUploadLink(staff, { case: kase.number }));
    expect(await revokeUploadLink(staff, { case: kase.number })).toEqual({ revoked: 1 });
    await expect(viewUploadPage(visitor, { secret: third })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const fourth = secretOf(await createUploadLink(staff, { case: kase.number }));
    await moveCaseStage(staff, { case: kase.number, stage: "COLLECTING" });
    await closeCase(staff, { case: kase.number, outcome: "WITHDRAWN", note: "Left Thailand" });
    await expect(viewUploadPage(visitor, { secret: fourth })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(viewUploadPage(visitor, { secret: "x".repeat(43) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses to share a checklist the client has nothing to upload on", async () => {
    const owner = createTestContext(db, (await createTestActor(db, "Owner")).actor, { storage });
    await createTemplate(owner, {
      slug: "tm30",
      name: "TM.30",
      items: [{ label: "Landlord files TM.30", kind: "OTHER" }],
    });
    await publishTemplateVersion(owner, { template: "tm30" });
    const client = await createClient(owner, { fullName: "Lars", nationality: "SE" });
    const kase = await createCase(owner, { clientId: client.id, template: "tm30" });
    await expect(createUploadLink(staff, { case: kase.number })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("shows the client their own files once their date of birth matches, and lets them remove one until it is checked", async () => {
    const kase = await openCase();
    const secret = secretOf(await createUploadLink(staff, { case: kase.number }));
    const passport = kase.items[0]?.id ?? "";
    const photos = kase.items[1]?.id ?? "";
    await acceptPrivacyNotice(visitor, { secret });
    const send = async (itemId: string, filename: string) => {
      const upload = await createClientUpload(visitor, {
        secret,
        itemId,
        filename,
        mimeType: "image/jpeg",
        sizeBytes: 4,
      });
      await storage.put(upload.uploadKey, new Uint8Array([1, 2, 3, 4]), "image/jpeg");
      return confirmClientUpload(visitor, {
        secret,
        itemId,
        uploadKey: upload.uploadKey,
        filename,
        mimeType: "image/jpeg",
      });
    };
    await send(passport, "passport.jpg");
    await send(photos, "photo.jpg");
    // A document the team stored on the case is never shown on the client's page.
    await db.document.create({
      data: {
        clientId: kase.client.id,
        caseId: kase.id,
        filename: "internal-notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sha256: "x",
        storageKey: "clients/internal-notes.pdf",
        uploadedById: staff.actor.employeeId,
      },
    });
    const view = (dateOfBirth: string) => listClientFiles(visitor, { secret, dateOfBirth });

    expect((await viewUploadPage(visitor, { secret })).canViewFiles).toBe(false);
    await expect(view("1960-04-02")).rejects.toMatchObject({ code: "CONFLICT" });
    await db.client.update({
      where: { id: kase.client.id },
      data: { dateOfBirth: new Date("1960-04-02T00:00:00.000Z") },
    });
    expect((await viewUploadPage(visitor, { secret })).canViewFiles).toBe(true);

    await expect(view("1961-04-02")).rejects.toThrow("2 tries left");
    const files = await view("1960-04-02");
    expect(files.items.map((i) => [i.label, i.files.map((f) => f.filename)])).toEqual([
      ["Passport", ["passport.jpg"]],
      ["Two photos", ["photo.jpg"]],
    ]);

    const passportFile = files.items[0]?.files[0]?.id ?? "";
    const opened = await clientFileLink(visitor, {
      secret,
      dateOfBirth: "1960-04-02",
      documentId: passportFile,
    });
    expect(opened.url).toContain("disposition=inline");
    const reads = await db.auditLog.findMany({ where: { via: "CLIENT", action: "document.read" } });
    expect(reads.map((r) => r.entityId)).toEqual([passportFile]);

    // Once the team has checked an item, the client can no longer change its files.
    await updateCaseItem(staff, { case: kase.number, itemId: photos, status: "VERIFIED" });
    const photoFile = files.items[1]?.files[0]?.id ?? "";
    await expect(
      removeClientFile(visitor, { secret, dateOfBirth: "1960-04-02", documentId: photoFile }),
    ).rejects.toThrow("already checked");

    // Removing the only file of a received item sends it back to missing.
    const removed = await removeClientFile(visitor, {
      secret,
      dateOfBirth: "1960-04-02",
      documentId: passportFile,
    });
    expect(removed.page.items[0]).toMatchObject({ label: "Passport", state: "needed" });
    expect(removed.files.items[0]?.files).toEqual([]);
    const detail = await getCase(staff, { case: kase.number });
    expect(detail.items[0]).toMatchObject({
      status: "MISSING",
      note: "The client removed their upload.",
    });

    // Three wrong dates lock viewing for the day, even with the right date afterwards.
    for (const wrong of ["1990-01-01", "1990-01-02"])
      await expect(view(wrong)).rejects.toThrow("left");
    await expect(view("1990-01-03")).rejects.toThrow("locked until tomorrow");
    await expect(view("1960-04-02")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
