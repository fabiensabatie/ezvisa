import { randomUUID } from "node:crypto";
import type { Prisma } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireHuman, requireLevel, requireStorage } from "../context.js";
import { bangkokToday, formatDateOnly } from "../dates.js";
import { DomainError } from "../errors.js";
import { canRead } from "../forms/ai.js";
import { placeBlank, readTextLayer, type TextPage } from "../forms/layout.js";
import { readScanLines } from "../forms/lines.js";
import {
  addFields,
  type FillValue,
  fillPdf,
  inspectPdf,
  type PdfField,
  uprightPages,
} from "../forms/pdf.js";
import {
  FORMATS,
  formatValue,
  resolveSource,
  SOURCE_KEYS,
  SOURCES,
  type SourceContext,
} from "../forms/sources.js";
import { hasLevel } from "../permissions.js";
import { caseNumber, caseRef, caseWhere, id, notFound } from "../refs.js";
import { readPublicSettings } from "./settings.js";
import { readableTemplateFile } from "./templates.js";

/** A field EzVisa fills, with where its value comes from. */
export type FormField = PdfField & {
  label: string;
  /** A source key (client.passportNo…), "ai" for an agent reading the documents, or null for the team */
  source: string | null;
  format: string;
  hint: string;
};

export type FieldMap = {
  version: 1;
  /** native: the PDF had its fields; added: EzVisa added them to a flat PDF */
  origin: "native" | "added";
  analyzedAt: string;
  pages: Array<{ width: number; height: number }>;
  fields: FormField[];
};

/** One filled value and who filled it. A person's values are never overwritten by a new fill. */
type StoredValue = {
  value: string | boolean | null;
  by: "source" | "agent" | "person";
  from?: string;
};
type Values = Record<string, StoredValue>;

const LINK_SECONDS = 5 * 60;
const MAX_DOCUMENTS_READ = 15;
const MAX_READ_BYTES = 20 * 1024 * 1024;
const FILLABLE_KINDS = ["PDF_FORM", "LETTER"];
const FORMAT_KEYS = FORMATS.map((f) => f.key) as readonly string[];

const isPdf = (f: { mimeType: string }) => f.mimeType === "application/pdf";
const dirOf = (key: string) => key.replace(/\/[^/]+$/, "");
const sourceLabel = (key: string) => SOURCES.find((s) => s.key === key)?.label ?? key;
/** Changes when the PDF does, so a viewer redraws only then (links change on every read). */
const versionOf = (key: string) => key.replace(/^.*\//, "").replace(/\.pdf$/i, "");

function fieldMapOf(file: { fieldMap: unknown }): FieldMap | null {
  const map = file.fieldMap as FieldMap | null;
  return map && Array.isArray(map.fields) ? map : null;
}

function cleanSource(source: string | null | undefined): string | null {
  if (!source || source === "none") return null;
  return source === "ai" || SOURCE_KEYS.includes(source) ? source : null;
}

/** "Family name" → "family_name_3", unique within the form. */
function fieldName(label: string, index: number, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let name = `${base}_${index + 1}`;
  while (taken.has(name)) name = `${name}_`;
  taken.add(name);
  return name;
}

// ---- template forms: making them fillable -----------------------------------------------------

/** What blanks can be anchored to on each page: printed text, or a scan's writing lines. */
async function readLayout(bytes: Uint8Array): Promise<TextPage[]> {
  const text = await readTextLayer(bytes).catch((): TextPage[] => []);
  // A page with almost no text is a scan, even inside a PDF with typed pages.
  if (text.length > 0 && text.every((p) => p.items.length >= 3)) return text;
  const scan = await readScanLines(bytes).catch((): TextPage[] => []);
  return (scan.length ? scan : text).map((page, index) =>
    (text[index]?.items.length ?? 0) >= 3 ? (text[index] as TextPage) : page,
  );
}

export const templateFormInput = z.object({
  fileId: id("Template file"),
  case: caseRef.optional().describe("Open it as part of this case: needs case access instead"),
});

/** The form's fields, where each value comes from, and a 5-minute link to the fillable PDF. */
export async function getTemplateForm(ctx: Context, raw: z.input<typeof templateFormInput>) {
  const input = templateFormInput.parse(raw);
  const { file, filename } = await readableTemplateFile(ctx, input);
  const map = fieldMapOf(file);
  const storage = requireStorage(ctx);
  return {
    fileId: file.id,
    name: file.name,
    kind: file.kind,
    canFill: isPdf(file),
    fillable: map !== null,
    settingUp: ctx.formJobs?.settingUp(file.id) ?? false,
    origin: map?.origin ?? null,
    analyzedAt: map?.analyzedAt ?? null,
    pages: map?.pages ?? [],
    fields: map?.fields ?? [],
    version: versionOf(file.fillableKey ?? file.storageKey),
    pdfUrl: isPdf(file)
      ? await storage.downloadUrl(
          file.fillableKey ?? file.storageKey,
          filename,
          LINK_SECONDS,
          "inline",
        )
      : null,
    sources: SOURCES,
    formats: FORMATS,
  };
}

export const analyzeTemplateFormInput = z.object({ fileId: id("Template file") });

/**
 * Makes a template's PDF fillable by EzVisa. A PDF with form fields keeps them; a flat scan
 * gets fields where Claude finds the blanks. Claude then labels every field and says where
 * its value comes from. Running it again starts the setup over.
 */
export async function analyzeTemplateForm(
  ctx: Context,
  raw: z.input<typeof analyzeTemplateFormInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { fileId } = analyzeTemplateFormInput.parse(raw);
  const file = await ctx.db.templateFile.findUnique({ where: { id: fileId } });
  if (!file) throw notFound("template file", fileId);
  if (!isPdf(file)) {
    throw new DomainError("CONFLICT", `${file.name} is not a PDF, so EzVisa cannot fill it.`);
  }
  const storage = requireStorage(ctx);
  const original = await storage.get(file.storageKey);
  const info = await inspectPdf(original);

  let origin: FieldMap["origin"] = "native";
  let pages = info.pages;
  let fields: PdfField[] = info.fields;
  let fillableKey: string | null = null;
  let fillable = original;
  if (fields.length === 0) {
    if (!ctx.forms) {
      throw new DomainError(
        "CONFLICT",
        `${file.name} has no form fields. Making it fillable needs Claude: set ANTHROPIC_API_KEY on the server.`,
      );
    }
    // Pages turned for display are redrawn upright first, so everything below agrees.
    const upright = await uprightPages(original);
    if (upright !== original) pages = (await inspectPdf(upright)).pages;
    // A scan has no text layer: its pages are read for writing lines instead. Without either,
    // the boxes come from Claude's estimate alone.
    const text = await readLayout(upright);
    const located = await ctx.forms.locateFields(upright, text);
    if (located.length === 0) {
      throw new DomainError("CONFLICT", `No blanks were found on ${file.name}.`);
    }
    const taken = new Set<string>();
    fields = located.map((f, index) => {
      const pageIndex = Math.min(f.page, pages.length - 1);
      const page = pages[pageIndex] ?? { width: 595, height: 842 };
      // Measured from the printed label when Claude named one; its estimate otherwise.
      const rect = placeBlank(text[pageIndex], f.anchor, f.type) ?? [
        f.box.left * page.width,
        (1 - f.box.bottom) * page.height,
        (f.box.right - f.box.left) * page.width,
        (f.box.bottom - f.box.top) * page.height,
      ];
      return {
        name: fieldName(f.label, index, taken),
        type: f.type,
        page: pageIndex,
        rect,
        multiline: f.multiline,
      };
    });
    fillable = await addFields(upright, fields);
    fillableKey = `${dirOf(file.storageKey)}/fillable-${randomUUID()}.pdf`;
    await storage.put(fillableKey, fillable, "application/pdf");
    origin = "added";
  }

  const described = ctx.forms
    ? await ctx.forms.describeFields(
        fillable,
        fields.map((f) => ({ name: f.name, type: f.type, page: f.page + 1, options: f.options })),
      )
    : [];
  const byName = new Map(described.map((d) => [d.name, d]));
  const map: FieldMap = {
    version: 1,
    origin,
    analyzedAt: ctx.now().toISOString(),
    pages,
    fields: fields.map((f) => {
      const d = byName.get(f.name);
      return {
        ...f,
        label: d?.label.trim() || f.name,
        source: cleanSource(d?.source),
        format: d && FORMAT_KEYS.includes(d.format) ? d.format : "text",
        hint: d?.hint.trim() ?? "",
      };
    }),
  };
  await ctx.db.$transaction(async (tx) => {
    await tx.templateFile.update({
      where: { id: file.id },
      data: { fieldMap: map as unknown as Prisma.InputJsonValue, fillableKey },
    });
    await audit(tx, ctx, {
      action: "template.form_set_up",
      entity: "TemplateFile",
      entityId: file.id,
      after: { origin, fields: map.fields.length },
    });
  });
  return getTemplateForm(ctx, { fileId: file.id });
}

/** Starts setting the form up in the background, like requestCaseForms. */
export async function requestTemplateForm(
  ctx: Context,
  raw: z.input<typeof analyzeTemplateFormInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { fileId } = analyzeTemplateFormInput.parse(raw);
  if (!ctx.formJobs) return analyzeTemplateForm(ctx, { fileId });
  const file = await ctx.db.templateFile.findUnique({ where: { id: fileId } });
  if (!file) throw notFound("template file", fileId);
  if (!isPdf(file)) {
    throw new DomainError("CONFLICT", `${file.name} is not a PDF, so EzVisa cannot fill it.`);
  }
  ctx.formJobs.setUpTemplateFile(file.id);
  return getTemplateForm(ctx, { fileId });
}

const editedField = z.object({
  name: z.string().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  source: z.string().nullable().describe('A source key, "ai", or null for the team'),
  format: z.string().default("text"),
  hint: z.string().max(1000).default(""),
  type: z.enum(["text", "checkbox", "radio", "dropdown"]).optional(),
  page: z.number().int().min(0).optional(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  multiline: z.boolean().optional(),
});

export const updateTemplateFormInput = z.object({
  fileId: id("Template file"),
  fields: z
    .array(editedField)
    .max(500)
    .describe(
      "Every field, as the form should be filled. On a PDF EzVisa made fillable, boxes can move, be added (new name) or removed (left out); on a PDF with its own fields only labels, sources, formats and hints change.",
    ),
});

/** Saves how a form is filled; on a PDF EzVisa made fillable, also where its boxes are. */
export async function updateTemplateForm(
  ctx: Context,
  raw: z.input<typeof updateTemplateFormInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const input = updateTemplateFormInput.parse(raw);
  const file = await ctx.db.templateFile.findUnique({ where: { id: input.fileId } });
  if (!file) throw notFound("template file", input.fileId);
  const map = fieldMapOf(file);
  if (!map) throw new DomainError("CONFLICT", `Set ${file.name} up for filling first.`);
  const storage = requireStorage(ctx);

  let fields: FormField[];
  let fillableKey = file.fillableKey;
  if (map.origin === "native") {
    // The PDF's own fields stay as they are; only how EzVisa fills them changes.
    const edits = new Map(input.fields.map((f) => [f.name, f]));
    fields = map.fields.map((f) => {
      const e = edits.get(f.name);
      return e
        ? {
            ...f,
            label: e.label,
            source: cleanSource(e.source),
            format: FORMAT_KEYS.includes(e.format) ? e.format : "text",
            hint: e.hint,
          }
        : f;
    });
  } else {
    const previous = new Map(map.fields.map((f) => [f.name, f]));
    const pageCount = map.pages.length;
    fields = input.fields.map((e) => {
      const before = previous.get(e.name);
      const rect = e.rect ?? before?.rect;
      if (!rect) {
        throw new DomainError("VALIDATION", `${e.label} needs a position on the page.`);
      }
      return {
        name: e.name,
        type: e.type ?? before?.type ?? "text",
        page: Math.min(e.page ?? before?.page ?? 0, pageCount - 1),
        rect,
        multiline: e.multiline ?? before?.multiline,
        options: before?.options,
        label: e.label,
        source: cleanSource(e.source),
        format: FORMAT_KEYS.includes(e.format) ? e.format : "text",
        hint: e.hint,
      };
    });
    // The boxes changed: make a new fillable copy from the original scan.
    const original = await storage.get(file.storageKey);
    const bytes = await addFields(await uprightPages(original), fields);
    fillableKey = `${dirOf(file.storageKey)}/fillable-${randomUUID()}.pdf`;
    await storage.put(fillableKey, bytes, "application/pdf");
  }
  const next: FieldMap = { ...map, fields };
  await ctx.db.$transaction(async (tx) => {
    await tx.templateFile.update({
      where: { id: file.id },
      data: { fieldMap: next as unknown as Prisma.InputJsonValue, fillableKey },
    });
    await audit(tx, ctx, {
      action: "template.form_updated",
      entity: "TemplateFile",
      entityId: file.id,
      after: { fields: fields.length },
    });
  });
  return getTemplateForm(ctx, { fileId: file.id });
}

// ---- case forms: filled, edited, checked ------------------------------------------------------

export const caseFormsInput = z.object({ case: caseRef });
export const caseFormInput = z.object({ case: caseRef, fileId: id("Template file") });

async function loadCase(ctx: Context, ref: string) {
  const kase = await ctx.db.case.findUnique({
    where: caseWhere(ref),
    include: {
      client: true,
      templateVersion: { include: { template: true, files: { orderBy: { name: "asc" } } } },
      forms: true,
    },
  });
  if (!kase) throw notFound("case", ref);
  return kase;
}
type LoadedCase = Awaited<ReturnType<typeof loadCase>>;

/** The case's PDF forms and letters that EzVisa fills. */
function formFiles(kase: LoadedCase) {
  return kase.templateVersion.files.filter((f) => isPdf(f) && FILLABLE_KINDS.includes(f.kind));
}

function summarize(
  file: LoadedCase["templateVersion"]["files"][number],
  form: LoadedCase["forms"][number] | undefined,
) {
  const map = fieldMapOf(file);
  const values = (form?.values ?? {}) as Values;
  const fillable = map?.fields ?? [];
  const filled = fillable.filter((f) => {
    const v = values[f.name]?.value;
    return v !== undefined && v !== null && v !== "";
  }).length;
  return {
    fileId: file.id,
    name: file.name,
    kind: file.kind,
    fillable: map !== null,
    fields: fillable.length,
    filled,
    toFill: fillable.filter((f) => f.source === null && !values[f.name]?.value).length,
    status: form?.status ?? null,
    preparedAt: form?.preparedAt?.toISOString() ?? null,
    checkedAt: form?.checkedAt?.toISOString() ?? null,
    checkedById: form?.checkedById ?? null,
  };
}

/** Where each form of the case stands: set up, filled, checked. */
export async function listCaseForms(ctx: Context, raw: z.input<typeof caseFormsInput>) {
  requireLevel(ctx, "cases", "view");
  const input = caseFormsInput.parse(raw);
  const kase = await loadCase(ctx, input.case);
  return {
    case: caseNumber(kase.number),
    preparing: ctx.formJobs?.preparing(kase.id) ?? false,
    forms: formFiles(kase).map((f) =>
      summarize(
        f,
        kase.forms.find((c) => c.templateFileId === f.id),
      ),
    ),
  };
}

/**
 * Starts filling the case's forms in the background and returns where they stand; check
 * back with listCaseForms. Without a background runner (tests, scripts) it fills them here.
 */
export async function requestCaseForms(ctx: Context, raw: z.input<typeof caseFormsInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = caseFormsInput.parse(raw);
  if (!ctx.formJobs) return prepareCaseForms(ctx, input);
  const kase = await ctx.db.case.findUnique({ where: caseWhere(input.case) });
  if (!kase) throw notFound("case", input.case);
  if (kase.stage === "DONE" || kase.stage === "CANCELLED") {
    throw new DomainError("CONFLICT", `${caseNumber(kase.number)} is closed.`);
  }
  ctx.formJobs.prepareCase(kase.id);
  return listCaseForms(ctx, input);
}

/** What EzVisa knows about the case, for an agent filling fields. */
async function caseFacts(ctx: Context, kase: LoadedCase) {
  // Every document of the client counts: the passport sent for the last case is still theirs.
  const all = await ctx.db.document.findMany({
    where: { clientId: kase.clientId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const documents = [
    ...all.filter((d) => d.caseId === kase.id),
    ...all.filter((d) => d.caseId !== kase.id),
  ];
  const otherCases = await ctx.db.case.findMany({
    where: { clientId: kase.clientId, id: { not: kase.id } },
    include: { templateVersion: { include: { template: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return {
    documents,
    otherCases: otherCases.map((c) => ({
      number: caseNumber(c.number),
      service: c.templateVersion.template.name,
      stage: c.stage,
      opened: formatDateOnly(c.createdAt),
    })),
  };
}

/**
 * Reads the client's documents nobody has read yet and keeps what was found on each, in the
 * same shape as update_document: { document: "Passport", "Place of birth": "Lyon", ... }.
 */
async function readDocuments(
  ctx: Context,
  documents: Awaited<ReturnType<typeof caseFacts>>["documents"],
) {
  const ai = ctx.forms;
  const storage = ctx.storage;
  if (!ai || !storage) return documents;
  const unread = documents
    .filter((d) => d.extracted === null)
    .filter((d) => canRead(d.mimeType) && d.sizeBytes <= MAX_READ_BYTES)
    .slice(0, MAX_DOCUMENTS_READ);
  for (const doc of unread) {
    try {
      const read = await ai.readDocument({
        bytes: await storage.get(doc.storageKey),
        mimeType: doc.mimeType,
        filename: doc.filename,
      });
      const extracted: Record<string, string> = { document: read.kind };
      for (const fact of read.facts) {
        if (fact.name.trim() && fact.value.trim()) extracted[fact.name.trim()] = fact.value.trim();
      }
      await ctx.db.document.update({
        where: { id: doc.id },
        data: { extracted: extracted as unknown as Prisma.InputJsonValue },
      });
      doc.extracted = extracted as unknown as Prisma.JsonValue;
      await audit(ctx.db, ctx, {
        action: "document.extracted",
        entity: "Document",
        entityId: doc.id,
        after: { kind: read.kind, facts: read.facts.length },
      });
    } catch {
      // One unreadable document does not stop the others; it stays unread for next time.
    }
  }
  return documents;
}

function toFillValue(field: FormField, value: string | boolean | null): FillValue {
  if (value === null) return null;
  if (field.type === "checkbox") return value === true || value === "true";
  return typeof value === "string" ? formatValue(value, field.format) : value ? "true" : "";
}

/** Fills the PDF from the values and stores it; returns its key. */
async function render(
  ctx: Context,
  kase: { id: string },
  file: { id: string; storageKey: string; fillableKey: string | null },
  fields: FormField[],
  values: Values,
) {
  const storage = requireStorage(ctx);
  const template = await storage.get(file.fillableKey ?? file.storageKey);
  const fill: Record<string, FillValue> = {};
  for (const field of fields) {
    const stored = values[field.name];
    if (stored) fill[field.name] = toFillValue(field, stored.value);
  }
  const bytes = await fillPdf(template, fill);
  const key = `cases/${kase.id}/forms/${file.id}/${randomUUID()}.pdf`;
  await storage.put(key, bytes, "application/pdf");
  return key;
}

const filledIn = (v: StoredValue | undefined) =>
  v !== undefined && v.value !== null && v.value !== "";

/** Field by field: Postgres keeps JSON keys in its own order. */
function sameValues(a: Values, b: Values): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every(
    (n) => a[n]?.value === b[n]?.value && a[n]?.by === b[n]?.by && a[n]?.from === b[n]?.from,
  );
}

/**
 * Fills the case's forms: values from the client record and the case first, then, with Claude,
 * the rest from what it reads on the client's documents. Values a person entered are kept.
 * Forms not set up yet are set up first when the actor may edit templates.
 */
export async function prepareCaseForms(
  ctx: Context,
  raw: z.input<typeof caseFormsInput> & { fileId?: string },
) {
  requireLevel(ctx, "cases", "edit");
  const input = caseFormsInput.extend({ fileId: id("Template file").optional() }).parse(raw);
  let kase = await loadCase(ctx, input.case);
  const files = formFiles(kase).filter((f) => !input.fileId || f.id === input.fileId);
  if (input.fileId && files.length === 0) {
    throw notFound("form on this case's template", input.fileId);
  }
  const notSetUp = files.filter((f) => !fieldMapOf(f));
  if (notSetUp.length && hasLevel(ctx.actor.permissions, "templates", "edit")) {
    for (const f of notSetUp) {
      try {
        await analyzeTemplateForm(ctx, { fileId: f.id });
      } catch {
        // Left for a person to set up on the template.
      }
    }
    kase = await loadCase(ctx, input.case);
  }

  const { agentName } = await readPublicSettings(ctx.db);
  const today = bangkokToday(ctx.now());
  const sources: SourceContext = {
    client: kase.client,
    case: {
      number: caseNumber(kase.number),
      service: kase.templateVersion.template.name,
      dueDate: kase.dueDate,
      office: kase.templateVersion.template.office,
    },
    agencyName: agentName,
    today,
  };
  const known = await caseFacts(ctx, kase);
  const documents = await readDocuments(ctx, known.documents);
  const facts = {
    client: {
      fullName: kase.client.fullName,
      nationality: kase.client.nationality,
      passportNo: kase.client.passportNo,
      dateOfBirth: kase.client.dateOfBirth ? formatDateOnly(kase.client.dateOfBirth) : null,
      email: kase.client.email,
      phone: kase.client.phone,
      address: kase.client.address,
      visaType: kase.client.visaType,
      stayUntil: kase.client.stayUntil ? formatDateOnly(kase.client.stayUntil) : null,
      notes: kase.client.notes,
    },
    case: { ...sources.case, dueDate: kase.dueDate ? formatDateOnly(kase.dueDate) : null },
    agency: agentName,
    today,
    otherCases: known.otherCases,
    documents: documents.map((d) => ({
      filename: d.filename,
      ...((d.extracted as object | null) ?? {}),
    })),
  };

  const results = [];
  for (const file of formFiles(kase).filter((f) => files.some((x) => x.id === f.id))) {
    const map = fieldMapOf(file);
    if (!map) {
      results.push({ fileId: file.id, name: file.name, prepared: false, reason: "not set up" });
      continue;
    }
    const existing = kase.forms.find((f) => f.templateFileId === file.id);
    const before = (existing?.values ?? {}) as Values;
    const values: Values = {};
    const toAsk: FormField[] = [];
    for (const field of map.fields) {
      const kept = before[field.name];
      if (kept?.by === "person") {
        values[field.name] = kept;
        continue;
      }
      if (field.source && field.source !== "ai") {
        const value = resolveSource(field.source, sources);
        if (value !== null) {
          values[field.name] = { value, by: "source", from: sourceLabel(field.source) };
          continue;
        }
      }
      // Claude fills what the record lacks from the documents (a passport number not typed
      // into the record yet, read from the passport).
      if (field.source !== null) toAsk.push(field);
      if (kept) values[field.name] = kept;
    }
    if (toAsk.length && ctx.forms) {
      const answers = await ctx.forms.fillFields(
        file.name,
        toAsk.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          options: f.options,
          hint: f.hint,
          format: f.format,
        })),
        facts,
      );
      for (const a of answers) {
        if (!a.value.trim()) continue;
        values[a.name] = { value: a.value.trim(), by: "agent", from: a.from };
      }
    }
    const pdfKey = await render(ctx, kase, file, map.fields, values);
    const changed = !sameValues(values, before);
    await ctx.db.$transaction(async (tx) => {
      await tx.caseForm.upsert({
        where: { caseId_templateFileId: { caseId: kase.id, templateFileId: file.id } },
        update: {
          values: values as unknown as Prisma.InputJsonValue,
          pdfKey,
          preparedAt: ctx.now(),
          updatedById: ctx.actor.employeeId,
          ...(changed ? { status: "DRAFT", checkedAt: null, checkedById: null } : {}),
        },
        create: {
          caseId: kase.id,
          templateFileId: file.id,
          values: values as unknown as Prisma.InputJsonValue,
          pdfKey,
          preparedAt: ctx.now(),
          updatedById: ctx.actor.employeeId,
        },
      });
      await audit(tx, ctx, {
        action: "case_form.prepared",
        entity: "Case",
        entityId: kase.id,
        after: {
          form: file.name,
          filled: map.fields.filter((f) => filledIn(values[f.name])).length,
          fields: map.fields.length,
        },
      });
    });
    results.push({ fileId: file.id, name: file.name, prepared: true });
  }
  return { ...(await listCaseForms(ctx, { case: input.case })), results };
}

/** A filled form: every field with its value and who filled it, and links to the PDF. */
export async function getCaseForm(ctx: Context, raw: z.input<typeof caseFormInput>) {
  requireLevel(ctx, "cases", "view");
  const input = caseFormInput.parse(raw);
  const kase = await loadCase(ctx, input.case);
  const file = formFiles(kase).find((f) => f.id === input.fileId);
  if (!file) throw notFound("form on this case's template", input.fileId);
  const map = fieldMapOf(file);
  const form = kase.forms.find((f) => f.templateFileId === file.id);
  const values = (form?.values ?? {}) as Values;
  const storage = requireStorage(ctx);
  const name = `${caseNumber(kase.number)} ${file.name}.pdf`;
  const key = form?.pdfKey ?? file.fillableKey ?? file.storageKey;
  const checker = form?.checkedById
    ? await ctx.db.employee.findUnique({ where: { id: form.checkedById }, select: { name: true } })
    : null;
  return {
    ...summarize(file, form),
    case: caseNumber(kase.number),
    origin: map?.origin ?? null,
    pages: map?.pages ?? [],
    checkedBy: checker?.name ?? null,
    fields: (map?.fields ?? []).map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options ?? null,
      source: f.source,
      format: f.format,
      hint: f.hint,
      page: f.page,
      rect: f.rect,
      multiline: f.multiline ?? false,
      value: values[f.name]?.value ?? null,
      /** As printed on the PDF, after the field's format */
      printed: values[f.name] ? (toFillValue(f, values[f.name]?.value ?? null) ?? null) : null,
      by: values[f.name]?.by ?? null,
      from: values[f.name]?.from ?? null,
    })),
    version: versionOf(key),
    pdfUrl: await storage.downloadUrl(key, name, LINK_SECONDS, "inline"),
    downloadUrl: await storage.downloadUrl(key, name, LINK_SECONDS, "attachment"),
  };
}

export const updateCaseFormInput = caseFormInput.extend({
  values: z
    .record(z.string(), z.union([z.string().max(2000), z.boolean(), z.null()]))
    .describe(
      "Field name → value. Text as written on the form; checkboxes true/false; null clears.",
    ),
});

/**
 * Saves values on a case's form and makes a new PDF. Values a person enters are kept on later
 * fills. Any change sends a checked form back to draft, to be checked again.
 */
export async function updateCaseForm(ctx: Context, raw: z.input<typeof updateCaseFormInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = updateCaseFormInput.parse(raw);
  const kase = await loadCase(ctx, input.case);
  const file = formFiles(kase).find((f) => f.id === input.fileId);
  if (!file) throw notFound("form on this case's template", input.fileId);
  const map = fieldMapOf(file);
  if (!map) throw new DomainError("CONFLICT", `${file.name} is not set up for filling yet.`);
  const known = new Set(map.fields.map((f) => f.name));
  const unknown = Object.keys(input.values).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new DomainError("VALIDATION", `${file.name} has no field ${unknown.join(", ")}.`);
  }
  const form = kase.forms.find((f) => f.templateFileId === file.id);
  const values = { ...((form?.values ?? {}) as Values) };
  const by = ctx.actor.kind === "HUMAN" ? "person" : "agent";
  for (const [name, value] of Object.entries(input.values)) {
    values[name] = { value, by, from: ctx.actor.name };
  }
  const pdfKey = await render(ctx, kase, file, map.fields, values);
  await ctx.db.$transaction(async (tx) => {
    await tx.caseForm.upsert({
      where: { caseId_templateFileId: { caseId: kase.id, templateFileId: file.id } },
      update: {
        values: values as unknown as Prisma.InputJsonValue,
        pdfKey,
        status: "DRAFT",
        checkedAt: null,
        checkedById: null,
        updatedById: ctx.actor.employeeId,
      },
      create: {
        caseId: kase.id,
        templateFileId: file.id,
        values: values as unknown as Prisma.InputJsonValue,
        pdfKey,
        updatedById: ctx.actor.employeeId,
      },
    });
    await audit(tx, ctx, {
      action: "case_form.updated",
      entity: "Case",
      entityId: kase.id,
      after: { form: file.name, fields: Object.keys(input.values) },
    });
  });
  return getCaseForm(ctx, input);
}

/** A person confirms every value on the form is right. Assistants and agents cannot. */
export async function checkCaseForm(ctx: Context, raw: z.input<typeof caseFormInput>) {
  requireLevel(ctx, "cases", "edit");
  requireHuman(ctx, "check a form");
  const input = caseFormInput.parse(raw);
  const kase = await loadCase(ctx, input.case);
  const form = kase.forms.find((f) => f.templateFileId === input.fileId);
  if (!form) throw new DomainError("CONFLICT", "Fill this form before checking it.");
  await ctx.db.$transaction(async (tx) => {
    await tx.caseForm.update({
      where: { id: form.id },
      data: { status: "CHECKED", checkedAt: ctx.now(), checkedById: ctx.actor.employeeId },
    });
    await audit(tx, ctx, {
      action: "case_form.checked",
      entity: "Case",
      entityId: kase.id,
      after: { fileId: input.fileId },
    });
  });
  return getCaseForm(ctx, input);
}

/** The filled PDF itself, for an assistant to read it over. */
export async function readCaseForm(ctx: Context, raw: z.input<typeof caseFormInput>) {
  requireLevel(ctx, "cases", "view");
  const input = caseFormInput.parse(raw);
  const kase = await loadCase(ctx, input.case);
  const file = formFiles(kase).find((f) => f.id === input.fileId);
  if (!file) throw notFound("form on this case's template", input.fileId);
  const form = kase.forms.find((f) => f.templateFileId === file.id);
  const storage = requireStorage(ctx);
  const bytes = await storage.get(form?.pdfKey ?? file.fillableKey ?? file.storageKey);
  await audit(ctx.db, ctx, {
    action: "case_form.read",
    entity: "Case",
    entityId: kase.id,
    after: { form: file.name },
  });
  return { form: { ...summarize(file, form), case: caseNumber(kase.number) }, bytes };
}
