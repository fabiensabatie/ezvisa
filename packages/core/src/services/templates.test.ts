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
import { closeCase, createCase, getCase, updateCaseItem } from "./cases.js";
import { createClient } from "./clients.js";
import { uploadDocument } from "./documents.js";
import {
  addTemplateItem,
  attachTemplateFile,
  confirmTemplateFileUpload,
  createTemplate,
  createTemplateFileUpload,
  discardTemplateDraft,
  getTemplate,
  getTemplateFile,
  publishTemplateVersion,
  readTemplateFile,
  removeTemplateFile,
  removeTemplateItem,
  reorderTemplateItems,
  updateTemplate,
  updateTemplateItem,
} from "./templates.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("templates service", () => {
  let db: Db;
  let owner: Context;
  const storage = new MemoryStorage();

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    storage.objects.clear();
    owner = createTestContext(db, (await createTestActor(db, "Owner")).actor, { storage });
  });

  it("refuses to open a case before the template is published", async () => {
    await createTemplate(owner, { slug: "tm30", name: "TM.30", items: [{ label: "Passport" }] });
    const client = await createClient(owner, { fullName: "Lars", nationality: "SE" });
    await expect(
      createCase(owner, { clientId: client.id, template: "tm30" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("edits a draft copied from the published version, then brings open cases onto it", async () => {
    const v1 = await publishSampleTemplate(owner);
    expect(v1.publishedVersion).toBe(1);
    const client = await createClient(owner, { fullName: "Margaret", nationality: "GB" });
    const openCase = await createCase(owner, {
      clientId: client.id,
      template: "retirement-extension",
    });

    // Editing with a published item id creates draft v2 and maps the id onto its copy.
    const publishedPhotos = v1.published?.items[2];
    const draft = await updateTemplateItem(owner, {
      template: "retirement-extension",
      itemId: publishedPhotos?.id ?? "",
      label: "Two photos, 4 × 6 cm, white background",
    });
    expect(draft.draftVersion).toBe(2);
    expect(draft.draft?.items[2]?.label).toBe("Two photos, 4 × 6 cm, white background");

    await addTemplateItem(owner, {
      template: "retirement-extension",
      label: "TM.30 receipt",
      position: 2,
    });
    const published = await publishTemplateVersion(owner, {
      template: "retirement-extension",
      notes: "Photo rule",
    });
    expect(published.publishedVersion).toBe(2);
    expect(published.published?.items.map((i) => i.label)).toEqual([
      "Passport with all stamped pages",
      "TM.30 receipt",
      "Bank letter confirming the balance",
      "Two photos, 4 × 6 cm, white background",
      "Map to the residence",
    ]);

    expect(published.casesUpdated).toBe(1);
    const updated = await getCase(owner, { case: openCase.number });
    expect(updated.template.version).toBe(2);
    expect(updated.items.map((i) => i.label)).toEqual(
      published.published?.items.map((i) => i.label),
    );
    // The renamed item is the same item: its id stays, and it now points at the v2 item.
    expect(updated.items[3]?.id).toBe(openCase.items[2]?.id);

    const v1Now = await getTemplate(owner, { template: "retirement-extension", version: 1 });
    expect(v1Now.selected.status).toBe("RETIRED");
  });

  it("keeps an open case's progress on publish, and drops the items the template removed", async () => {
    const v1 = await publishSampleTemplate(owner);
    const client = await createClient(owner, {
      fullName: "Akira Sato",
      nationality: "JP",
      consentGiven: true,
    });
    const kase = await createCase(owner, { clientId: client.id, template: "retirement-extension" });
    const [passport, bank, photos] = kase.items;
    await updateCaseItem(owner, {
      case: kase.number,
      itemId: photos?.id ?? "",
      status: "FLAGGED",
      note: "photo background is grey",
    });
    const scan = await uploadDocument(owner, {
      clientId: client.id,
      filename: "bank.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7 bank").toString("base64"),
      case: kase.number,
      caseItemId: bank?.id,
    });
    const closed = await createCase(owner, {
      clientId: client.id,
      template: "retirement-extension",
    });
    await closeCase(owner, { case: closed.number, outcome: "WITHDRAWN", note: "Client left" });

    // v2 drops the bank letter, stops asking the client for the passport and adds an item.
    const [v1Passport, v1Bank] = v1.published?.items ?? [];
    await updateTemplateItem(owner, {
      template: "retirement-extension",
      itemId: v1Passport?.id ?? "",
      clientUpload: false,
    });
    const draft = await getTemplate(owner, { template: "retirement-extension", version: "draft" });
    const draftBank = draft.selected.items.find((i) => i.label === v1Bank?.label);
    await removeTemplateItem(owner, {
      template: "retirement-extension",
      itemId: draftBank?.id ?? "",
    });
    await addTemplateItem(owner, { template: "retirement-extension", label: "TM.30 receipt" });
    // v3 changes nothing for the case, so the lineage runs through two versions.
    await publishTemplateVersion(owner, { template: "retirement-extension" });
    await updateTemplate(owner, { template: "retirement-extension", notes: "Wording" });
    await publishTemplateVersion(owner, { template: "retirement-extension" });

    const now = await getCase(owner, { case: kase.number });
    expect(now.template.version).toBe(3);
    expect(now.items.map((i) => [i.label, i.status, i.clientUpload])).toEqual([
      ["Passport with all stamped pages", "MISSING", false],
      ["Two photos, 4 × 6 cm", "FLAGGED", true],
      ["Map to the residence", "MISSING", true],
      ["TM.30 receipt", "MISSING", true],
    ]);
    expect(now.items[0]?.id).toBe(passport?.id);
    expect(now.items[1]).toMatchObject({ id: photos?.id, note: "photo background is grey" });
    // The bank letter's document stays on the case, no longer behind an item.
    expect(now.documents.map((d) => d.id)).toEqual([scan.id]);

    const untouched = await getCase(owner, { case: closed.number });
    expect(untouched.template.version).toBe(1);
    expect(untouched.items).toHaveLength(4);
  });

  it("reorders draft items and rejects incomplete orders", async () => {
    await createTemplate(owner, {
      slug: "ninety-day",
      name: "90-day report",
      items: [{ label: "A" }, { label: "B" }, { label: "C" }],
    });
    const draft = await getTemplate(owner, { template: "ninety-day", version: "draft" });
    const [a, b, c] = draft.selected.items.map((i) => i.id);
    await expect(
      reorderTemplateItems(owner, { template: "ninety-day", itemIds: [c ?? "", a ?? ""] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const reordered = await reorderTemplateItems(owner, {
      template: "ninety-day",
      itemIds: [c ?? "", a ?? "", b ?? ""],
    });
    expect(reordered.draft?.items.map((i) => i.label)).toEqual(["C", "A", "B"]);
  });

  it("attaches a form to an item and keeps shared files until no version uses them", async () => {
    await publishSampleTemplate(owner);
    const withFile = await attachTemplateFile(owner, {
      template: "retirement-extension",
      name: "TM.7 application",
      kind: "PDF_FORM",
      filename: "TM7.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7 test").toString("base64"),
    });
    const file = withFile.draft?.files[0];
    expect(file).toMatchObject({ name: "TM.7 application", kind: "PDF_FORM" });
    expect(storage.objects.size).toBe(1);

    await publishTemplateVersion(owner, { template: "retirement-extension" });
    // A new draft copies the file row; removing it there must keep the object for v2.
    const draft3 = await removeTemplateFile(owner, {
      template: "retirement-extension",
      fileId: file?.id ?? "",
    });
    expect(draft3.draft?.files).toHaveLength(0);
    expect(storage.objects.size).toBe(1);
  });

  it("attaches a form uploaded through a presigned link, once", async () => {
    await publishSampleTemplate(owner);
    const items = (await getTemplate(owner, { template: "retirement-extension" })).selected.items;
    const upload = await createTemplateFileUpload(owner, {
      template: "retirement-extension",
      filename: "TM 7 (2026).pdf",
      mimeType: "application/pdf",
      sizeBytes: 13,
    });
    expect(upload.uploadKey).toMatch(/^templates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/TM_7_2026_\.pdf$/);
    const confirm = {
      template: "retirement-extension",
      uploadKey: upload.uploadKey,
      name: "TM.7 application",
      kind: "PDF_FORM" as const,
      mimeType: "application/pdf",
      itemId: items[0]?.id,
    };
    await expect(confirmTemplateFileUpload(owner, confirm)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await storage.put(upload.uploadKey, Buffer.from("%PDF-1.7 test"), "application/pdf");
    const draft = await confirmTemplateFileUpload(owner, confirm);
    const file = draft.draft?.files[0];
    expect(file).toMatchObject({ name: "TM.7 application", sizeBytes: 13 });
    expect(draft.draft?.items[0]?.formFileId).toBe(file?.id);
    await expect(confirmTemplateFileUpload(owner, confirm)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await expect(
      confirmTemplateFileUpload(owner, {
        ...confirm,
        uploadKey: upload.uploadKey.replace(/^templates\/[0-9a-f-]{36}/, `templates/${file?.id}`),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("discards a draft, keeping the published version and its files", async () => {
    await publishSampleTemplate(owner);
    await attachTemplateFile(owner, {
      template: "retirement-extension",
      name: "Letter",
      kind: "LETTER",
      filename: "letter.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7 letter").toString("base64"),
    });
    expect(storage.objects.size).toBe(1);

    const after = await discardTemplateDraft(owner, { template: "retirement-extension" });
    expect(after).toMatchObject({ publishedVersion: 1, draftVersion: null });
    expect(storage.objects.size).toBe(0);
    await expect(
      discardTemplateDraft(owner, { template: "retirement-extension" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await createTemplate(owner, { slug: "tm30", name: "TM.30", items: [{ label: "Passport" }] });
    await expect(discardTemplateDraft(owner, { template: "tm30" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("gives a case its template's forms, and opens them through the case", async () => {
    // v1 gets a TM.7 form behind its first item, then is published.
    await publishSampleTemplate(owner);
    const withForm = await attachTemplateFile(owner, {
      template: "retirement-extension",
      name: "TM.7 application",
      kind: "PDF_FORM",
      filename: "tm7-2025.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7 blank TM.7").toString("base64"),
      itemId: (await getTemplate(owner, { template: "retirement-extension" })).selected.items[0]
        ?.id,
    });
    const form = withForm.draft?.files[0];
    await publishTemplateVersion(owner, { template: "retirement-extension" });

    const client = await createClient(owner, { fullName: "Jo Maupas", nationality: "FR" });
    const kase = await createCase(owner, { clientId: client.id, template: "retirement-extension" });
    expect(kase.forms).toEqual([
      expect.objectContaining({ id: form?.id, name: "TM.7 application" }),
    ]);
    expect(kase.items[0]?.formFileId).toBe(form?.id);
    expect(kase.items[1]?.formFileId).toBeNull();

    // Opening saves under the display name with the uploaded extension; "download" saves it.
    const open = await getTemplateFile(owner, { fileId: form?.id ?? "", case: kase.number });
    expect(open).toMatchObject({ filename: "TM.7 application.pdf", version: 2 });
    expect(open.downloadUrl).toMatch(/disposition=inline$/);
    expect(open.curl).toBe(`curl --fail -o "TM.7 application.pdf" "${open.downloadUrl}"`);
    const save = await getTemplateFile(owner, { fileId: form?.id ?? "", download: true });
    expect(save.downloadUrl).toMatch(/disposition=attachment$/);

    const read = await readTemplateFile(owner, { fileId: form?.id ?? "", case: kase.number });
    expect(Buffer.from(read.bytes).toString()).toBe("%PDF-1.7 blank TM.7");

    // A case opened from another template cannot reach this file.
    await createTemplate(owner, { slug: "tm30", name: "TM.30", items: [{ label: "Passport" }] });
    await publishTemplateVersion(owner, { template: "tm30" });
    const other = await createCase(owner, { clientId: client.id, template: "tm30" });
    await expect(
      getTemplateFile(owner, { fileId: form?.id ?? "", case: other.number }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to read a large template file inline", async () => {
    await publishSampleTemplate(owner);
    const upload = await createTemplateFileUpload(owner, {
      template: "retirement-extension",
      filename: "scan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11 * 1024 * 1024,
    });
    await storage.put(upload.uploadKey, new Uint8Array(11 * 1024 * 1024), "application/pdf");
    const draft = await confirmTemplateFileUpload(owner, {
      template: "retirement-extension",
      uploadKey: upload.uploadKey,
      name: "Scanned guide",
      kind: "REFERENCE",
      mimeType: "application/pdf",
    });
    const fileId = draft.draft?.files[0]?.id ?? "";
    await expect(readTemplateFile(owner, { fileId })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("Save it with get_template_file"),
    });
    expect((await getTemplateFile(owner, { fileId })).downloadUrl).toContain("scan.pdf");
  });
});
