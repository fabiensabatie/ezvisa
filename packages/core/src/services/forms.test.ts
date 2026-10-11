import { createDb, type Db } from "@ezvisa/db";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import { FakeFormAi } from "../forms/fakes.js";
import { inspectPdf, readPdfValues } from "../forms/pdf.js";
import { FormPreparer } from "../forms/preparer.js";
import { ASSISTANT_EMAIL } from "../seed-base.js";
import { MemoryStorage } from "../storage.js";
import { createTestActor, createTestContext, resetDatabase, testDatabaseUrl } from "../testing.js";
import { createCase, moveCaseStage } from "./cases.js";
import { createClient } from "./clients.js";
import {
  analyzeTemplateForm,
  checkCaseForm,
  getCaseForm,
  getTemplateForm,
  listCaseForms,
  prepareCaseForms,
  updateCaseForm,
  updateTemplateForm,
} from "./forms.js";
import { attachTemplateFile, createTemplate, publishTemplateVersion } from "./templates.js";
import {
  acceptPrivacyNotice,
  confirmClientUpload,
  createClientUpload,
  createUploadLink,
} from "./upload-links.js";

const url = testDatabaseUrl();

/** A TM.7-like form with its own fields. */
async function fillableForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  let y = 760;
  for (const name of ["full_name", "passport_no", "birth_date", "birth_place", "signature"]) {
    form.createTextField(name).addToPage(page, { x: 200, y, width: 300, height: 20 });
    y -= 40;
  }
  form.createCheckBox("married").addToPage(page, { x: 200, y, width: 14, height: 14 });
  return doc.save();
}

/** A scanned form with blanks to write on and no fields. */
async function flatForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Family name ....................", { x: 50, y: 740, size: 11, font });
  page.drawText("Signature ......................", { x: 50, y: 200, size: 11, font });
  return doc.save();
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe.skipIf(!url)("forms", () => {
  let db: Db;
  let owner: Context;
  let staff: Context;
  let assistant: Context;
  let ai: FakeFormAi;
  const storage = new MemoryStorage();

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    storage.objects.clear();
    ai = new FakeFormAi();
    ai.descriptions = {
      full_name: { label: "Name", source: "client.fullName", format: "upper", hint: "" },
      passport_no: { label: "Passport No.", source: "client.passportNo", format: "text", hint: "" },
      birth_date: {
        label: "Date of birth",
        source: "client.dateOfBirth",
        format: "date-be",
        hint: "",
      },
      birth_place: {
        label: "Place of birth",
        source: "ai",
        format: "text",
        hint: "As on the passport",
      },
      signature: {
        label: "Signature",
        source: "none",
        format: "text",
        hint: "The applicant signs",
      },
      married: { label: "Married", source: "ai", format: "text", hint: "" },
    };
    ai.documents = {
      "passport.pdf": { kind: "Passport", facts: [{ name: "Place of birth", value: "Lyon" }] },
    };
    ai.answers = {
      birth_place: { value: "Lyon", from: "Passport" },
      married: { value: "false", from: "client record" },
    };
    const forms = { storage, forms: ai };
    owner = {
      ...createTestContext(db, (await createTestActor(db, "Owner")).actor, { storage }),
      ...forms,
    };
    staff = {
      ...createTestContext(
        db,
        (await createTestActor(db, "Validator", { name: "Ploy S." })).actor,
        {
          storage,
        },
      ),
      ...forms,
    };
    assistant = {
      ...createTestContext(db, (await createTestActor(db, "Assistant (MCP)")).actor, { storage }),
      ...forms,
    };
  });

  /** A published template with the given PDF as its form, and a case on it. */
  async function caseWithForm(pdf: Uint8Array, ctx: Context = owner) {
    await createTemplate(ctx, {
      slug: "extension",
      name: "Retirement extension",
      items: [{ label: "Passport" }, { label: "TM.7 application", kind: "FORM" }],
    });
    const draft = await attachTemplateFile(ctx, {
      template: "extension",
      name: "TM.7 application",
      kind: "PDF_FORM",
      filename: "tm7.pdf",
      mimeType: "application/pdf",
      contentBase64: base64(pdf),
    });
    const fileId = draft.draft?.files[0]?.id ?? "";
    await publishTemplateVersion(ctx, { template: "extension" });
    const client = await createClient(ctx, {
      fullName: "Jo Maupas",
      nationality: "FR",
      passportNo: "FR123456",
      dateOfBirth: "1960-04-02",
    });
    const kase = await createCase(ctx, { clientId: client.id, template: "extension" });
    return { fileId, kase, client };
  }

  async function addPassport(clientId: string, caseId: string) {
    const key = `clients/${clientId}/passport.pdf`;
    await storage.put(key, await flatForm(), "application/pdf");
    return db.document.create({
      data: {
        clientId,
        caseId,
        filename: "passport.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: "x",
        storageKey: key,
      },
    });
  }

  const pdfOf = async (caseId: string) => {
    const form = await db.caseForm.findFirstOrThrow({ where: { caseId } });
    return readPdfValues(await storage.get(form.pdfKey ?? ""));
  };

  it("fills a case's form from the client record and what Claude reads on the documents", async () => {
    const { fileId, kase, client } = await caseWithForm(await fillableForm());
    const setUp = await analyzeTemplateForm(owner, { fileId });
    expect(setUp).toMatchObject({ fillable: true, origin: "native", canFill: true });
    expect(setUp.fields.map((f) => [f.name, f.label, f.source, f.format])).toEqual([
      ["full_name", "Name", "client.fullName", "upper"],
      ["passport_no", "Passport No.", "client.passportNo", "text"],
      ["birth_date", "Date of birth", "client.dateOfBirth", "date-be"],
      ["birth_place", "Place of birth", "ai", "text"],
      ["signature", "Signature", null, "text"],
      ["married", "Married", "ai", "text"],
    ]);
    expect(setUp.pdfUrl).toBeTruthy();
    // A PDF with its own fields is not copied.
    expect(
      (await db.templateFile.findUniqueOrThrow({ where: { id: fileId } })).fillableKey,
    ).toBeNull();

    expect((await listCaseForms(staff, { case: kase.number })).forms).toEqual([
      expect.objectContaining({
        name: "TM.7 application",
        fillable: true,
        fields: 6,
        status: null,
      }),
    ]);

    await addPassport(client.id, kase.id);
    const prepared = await prepareCaseForms(staff, { case: kase.number });
    expect(prepared.results).toEqual([{ fileId, name: "TM.7 application", prepared: true }]);
    expect(prepared.forms[0]).toMatchObject({ status: "DRAFT", filled: 5, toFill: 1 });
    expect(ai.asked[0]?.map((f) => f.name)).toEqual(["birth_place", "married"]);

    const form = await getCaseForm(staff, { case: kase.number, fileId });
    const byName = Object.fromEntries(form.fields.map((f) => [f.name, f]));
    expect(byName.full_name).toMatchObject({ value: "Jo Maupas", by: "source", from: "Full name" });
    expect(byName.birth_place).toMatchObject({ value: "Lyon", by: "agent", from: "Passport" });
    expect(byName.signature).toMatchObject({ value: null, by: null });
    expect(form.downloadUrl).toBeTruthy();

    // The PDF is written the way the form wants it, and stays fillable.
    const values = await pdfOf(kase.id);
    expect(values).toMatchObject({
      full_name: "JO MAUPAS",
      passport_no: "FR123456",
      birth_date: "02/04/2503",
      birth_place: "Lyon",
      married: false,
    });

    const doc = await db.document.findFirstOrThrow({ where: { caseId: kase.id } });
    expect(doc.extracted).toEqual({ document: "Passport", "Place of birth": "Lyon" });
  });

  it("keeps what a person entered, and only a person checks the form", async () => {
    const { fileId, kase, client } = await caseWithForm(await fillableForm());
    await analyzeTemplateForm(owner, { fileId });
    await addPassport(client.id, kase.id);
    await prepareCaseForms(staff, { case: kase.number });

    const edited = await updateCaseForm(staff, {
      case: kase.number,
      fileId,
      values: { birth_place: "Lyon, France", signature: "" },
    });
    expect(edited.fields.find((f) => f.name === "birth_place")).toMatchObject({
      value: "Lyon, France",
      by: "person",
      from: "Ploy S.",
    });
    await expect(
      updateCaseForm(staff, { case: kase.number, fileId, values: { nickname: "Jo" } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await prepareCaseForms(staff, { case: kase.number });
    expect((await pdfOf(kase.id)).birth_place).toBe("Lyon, France");
    // Documents are read once.
    expect(ai.calls.filter((c) => c.startsWith("read"))).toEqual(["read passport.pdf"]);

    await expect(checkCaseForm(assistant, { case: kase.number, fileId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const checked = await checkCaseForm(staff, { case: kase.number, fileId });
    expect(checked).toMatchObject({ status: "CHECKED", checkedBy: "Ploy S." });

    // Filling again with nothing new keeps the check; a change sends it back to draft.
    await prepareCaseForms(assistant, { case: kase.number });
    expect((await getCaseForm(staff, { case: kase.number, fileId })).status).toBe("CHECKED");
    const changed = await updateCaseForm(assistant, {
      case: kase.number,
      fileId,
      values: { married: true },
    });
    expect(changed).toMatchObject({ status: "DRAFT", checkedBy: null });
    expect(changed.fields.find((f) => f.name === "married")).toMatchObject({ by: "agent" });
  });

  it("adds fields to a flat PDF where Claude finds the blanks, and lets the team move them", async () => {
    const { fileId } = await caseWithForm(await flatForm());
    ai.located = [
      {
        label: "Family name",
        type: "text",
        page: 0,
        box: { left: 0.2, top: 0.1, right: 0.6, bottom: 0.13 },
        multiline: false,
      },
      {
        label: "Signature",
        type: "text",
        page: 0,
        box: { left: 0.2, top: 0.75, right: 0.5, bottom: 0.78 },
        multiline: false,
      },
    ];
    ai.descriptions = {
      family_name_1: { label: "Family name", source: "client.surname", format: "upper", hint: "" },
    };

    await expect(analyzeTemplateForm(assistant, { fileId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(analyzeTemplateForm({ ...owner, forms: null }, { fileId })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );

    const setUp = await analyzeTemplateForm(owner, { fileId });
    expect(setUp.origin).toBe("added");
    expect(setUp.fields.map((f) => [f.name, f.source])).toEqual([
      ["family_name_1", "client.surname"],
      ["signature_2", null],
    ]);
    const [x, y, w, h] = setUp.fields[0]?.rect ?? [];
    expect([x, y, w, h].map((n) => Math.round(n ?? 0))).toEqual([119, 733, 238, 25]);
    const file = await db.templateFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.fillableKey).toMatch(/fillable-[0-9a-f-]+\.pdf$/);
    const fillable = await inspectPdf(await storage.get(file.fillableKey ?? ""));
    expect(fillable.fields.map((f) => f.name)).toEqual(["family_name_1", "signature_2"]);

    const moved = await updateTemplateForm(owner, {
      fileId,
      fields: [
        {
          name: "family_name_1",
          label: "Surname",
          source: "client.surname",
          format: "upper",
          rect: [100, 700, 250, 20],
        },
        {
          name: "nationality",
          label: "Nationality",
          source: "client.nationality",
          page: 0,
          rect: [100, 650, 200, 20],
        },
      ],
    });
    expect(moved.fields.map((f) => [f.name, f.label, f.rect])).toEqual([
      ["family_name_1", "Surname", [100, 700, 250, 20]],
      ["nationality", "Nationality", [100, 650, 200, 20]],
    ]);
    const after = await db.templateFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(after.fillableKey).not.toBe(file.fillableKey);
    expect(
      (await inspectPdf(await storage.get(after.fillableKey ?? ""))).fields.map((f) => f.name),
    ).toEqual(["family_name_1", "nationality"]);
    expect((await getTemplateForm(staff, { fileId })).fields).toHaveLength(2);
  });

  it("sets up the template PDFs attached before, once per file", async () => {
    const { fileId } = await caseWithForm(await fillableForm());
    await attachTemplateFile(owner, {
      template: "extension",
      name: "Reference",
      kind: "REFERENCE",
      filename: "guide.pdf",
      mimeType: "application/pdf",
      contentBase64: base64(await flatForm()),
    });
    // The draft shares the published version's form file.
    const shared = await db.templateFile.findMany({ where: { name: "TM.7 application" } });
    expect(shared).toHaveLength(2);

    const preparer = new FormPreparer({ db, storage, ai, now: owner.now });
    preparer.setUpPending();
    await preparer.idle();
    const after = await db.templateFile.findMany({ orderBy: { name: "asc" } });
    expect(after.map((f) => [f.name, Boolean(f.fieldMap)])).toEqual([
      ["Reference", false],
      ["TM.7 application", true],
      ["TM.7 application", true],
    ]);
    expect(ai.calls.filter((c) => c === "describe")).toHaveLength(1);
    expect((await getTemplateForm(staff, { fileId })).fields).toHaveLength(6);
  });

  it("sets up forms and fills them in the background when the documents are in", async () => {
    const preparer = new FormPreparer({ db, storage, ai, now: owner.now });
    const jobs = { ...owner, formJobs: preparer };
    const { fileId, kase } = await caseWithForm(await fillableForm(), jobs);
    await preparer.idle();
    expect((await getTemplateForm(staff, { fileId })).fillable).toBe(true);
    expect(await db.caseForm.count()).toBe(0);

    // The client sends the last required document through their checklist link.
    const link = await createUploadLink(staff, { case: kase.number });
    const secret = link.url.split("#")[1] ?? "";
    const visitor = { db, storage, now: owner.now, formJobs: preparer };
    await acceptPrivacyNotice(visitor, { secret });
    const passport = (
      await db.caseItem.findFirstOrThrow({ where: { caseId: kase.id, label: "Passport" } })
    ).id;
    const upload = await createClientUpload(visitor, {
      secret,
      itemId: passport,
      filename: "passport.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });
    await storage.put(upload.uploadKey, await flatForm(), "application/pdf");
    await confirmClientUpload(visitor, {
      secret,
      itemId: passport,
      uploadKey: upload.uploadKey,
      filename: "passport.pdf",
      mimeType: "application/pdf",
    });
    await preparer.idle();
    const form = await db.caseForm.findFirstOrThrow({ where: { caseId: kase.id } });
    expect(form.status).toBe("DRAFT");
    expect((await pdfOf(kase.id)).birth_place).toBe("Lyon");
    const actions = await db.auditLog.findMany({
      where: { action: "case_form.prepared" },
      select: { actorId: true, via: true },
    });
    const helper = await db.employee.findUniqueOrThrow({ where: { email: ASSISTANT_EMAIL } });
    expect(actions).toEqual([{ actorId: helper.id, via: "SYSTEM" }]);

    // Moving the case to drafting fills them again with what came in since.
    await moveCaseStage({ ...staff, formJobs: preparer }, { case: kase.number, stage: "DRAFTING" });
    await preparer.idle();
    expect(await db.auditLog.count({ where: { action: "case_form.prepared" } })).toBe(2);
  });
});
