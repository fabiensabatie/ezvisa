import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import { MemoryStorage } from "../storage.js";
import {
  createTestActor,
  createTestContext,
  publishSampleTemplate,
  resetDatabase,
  testDatabaseUrl,
} from "../testing.js";
import { createCase, getCase } from "./cases.js";
import { createClient, updateClient } from "./clients.js";
import {
  confirmDocumentUpload,
  createDocumentUpload,
  deleteDocument,
  listDocuments,
  readDocument,
  updateDocument,
  uploadDocument,
} from "./documents.js";

const url = testDatabaseUrl();
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe.skipIf(!url)("documents service", () => {
  let db: Db;
  let owner: Context;
  let assistant: Context;
  let clientId: string;
  const storage = new MemoryStorage();

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    storage.objects.clear();
    owner = createTestContext(db, (await createTestActor(db, "Owner")).actor, { storage });
    assistant = createTestContext(db, (await createTestActor(db, "Assistant (MCP)")).actor, {
      storage,
    });
    clientId = (await createClient(owner, { fullName: "Sophie Laurent", nationality: "FR" })).id;
  });

  const upload = (ctx: Context, extra: Record<string, string> = {}) =>
    uploadDocument(ctx, {
      clientId,
      filename: "passport photo.png",
      mimeType: "image/png",
      contentBase64: PNG.toString("base64"),
      ...extra,
    });

  it("refuses to store documents before the client consents", async () => {
    await expect(upload(assistant)).rejects.toMatchObject({ code: "GUARD_FAILED" });
    await updateClient(owner, { clientId, consentGiven: true });
    const doc = await upload(assistant);
    expect(doc).toMatchObject({ filename: "passport photo.png", sizeBytes: PNG.byteLength });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks a MISSING checklist item RECEIVED when a document is attached to it", async () => {
    await updateClient(owner, { clientId, consentGiven: true });
    await publishSampleTemplate(owner);
    const c = await createCase(owner, { clientId, template: "retirement-extension" });
    const photos = c.items[2];
    await upload(assistant, { caseItemId: photos?.id ?? "" });
    const after = await getCase(owner, { case: c.number });
    expect(after.items[2]).toMatchObject({ status: "RECEIVED" });
    expect(after.items[2]?.documentIds).toHaveLength(1);
  });

  it("returns bytes on read and audits every read", async () => {
    await updateClient(owner, { clientId, consentGiven: true });
    const doc = await upload(assistant);
    const { bytes } = await readDocument(assistant, { documentId: doc.id });
    expect(Buffer.from(bytes).equals(PNG)).toBe(true);
    await updateDocument(assistant, { documentId: doc.id, extracted: { passportNo: "AB123" } });
    const actions = (
      await db.auditLog.findMany({ where: { entityId: doc.id }, orderBy: { id: "asc" } })
    ).map((a) => a.action);
    expect(actions).toEqual(["document.uploaded", "document.read", "document.extracted"]);
  });

  it("rejects disallowed types and keeps uploads within the client", async () => {
    await updateClient(owner, { clientId, consentGiven: true });
    await expect(upload(assistant, { mimeType: "application/x-msdownload" })).rejects.toMatchObject(
      {
        code: "VALIDATION",
      },
    );
    const other = await createClient(owner, {
      fullName: "Other",
      nationality: "TH",
      consentGiven: true,
    });
    const started = await createDocumentUpload(assistant, {
      clientId,
      filename: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
    });
    await storage.put(started.uploadKey, new Uint8Array([37, 80, 68, 70]), "application/pdf");
    await expect(
      confirmDocumentUpload(assistant, {
        uploadKey: started.uploadKey,
        clientId: other.id,
        filename: "statement.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const confirmed = await confirmDocumentUpload(assistant, {
      uploadKey: started.uploadKey,
      clientId,
      filename: "statement.pdf",
      mimeType: "application/pdf",
    });
    expect(confirmed.sizeBytes).toBe(4);
  });

  it("only full access deletes, and deleted documents disappear from lists", async () => {
    await updateClient(owner, { clientId, consentGiven: true });
    const doc = await upload(assistant);
    await expect(deleteDocument(assistant, { documentId: doc.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await deleteDocument(owner, { documentId: doc.id });
    expect((await listDocuments(owner, { clientId })).items).toHaveLength(0);
  });
});
