import { randomUUID } from "node:crypto";
import { Prisma } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireLevel, requireStorage, type Tx } from "../context.js";
import { templateSummaryDto, templateVersionDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { id, notFound, templateRef, templateWhere } from "../refs.js";
import { assertMimeType, decodeBase64File, MAX_UPLOAD_BYTES, safeFilename } from "./files.js";

const UPLOAD_URL_SECONDS = 10 * 60;

const itemKind = z.enum(["DOCUMENT", "FORM", "PAYMENT", "OTHER"]);
const fileKind = z.enum(["PDF_FORM", "LETTER", "REFERENCE"]);
const deadlineKind = z.enum(["STAY_ENDS", "REPORT_DUE"]);
const rules = z
  .record(z.string(), z.unknown())
  .describe('Machine-checkable rules, e.g. {"maxAgeDays": 7} for a bank letter');

const newItem = z.object({
  label: z.string().trim().min(1).max(200).describe("What the client must provide"),
  description: z.string().trim().max(1000).optional().describe("Details shown to staff and client"),
  kind: itemKind.default("DOCUMENT"),
  required: z.boolean().default(true),
  rules: rules.optional(),
});

export const listTemplatesInput = z.object({
  includeArchived: z.boolean().default(false),
});
export const getTemplateInput = z.object({
  template: templateRef,
  version: z
    .union([z.literal("draft"), z.literal("published"), z.number().int().min(1)])
    .optional()
    .describe('"published" (default), "draft", or a version number'),
});
export const createTemplateInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase words joined by hyphens")
    .describe('Stable identifier, e.g. "retirement-extension"'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  office: z.string().trim().max(120).optional().describe('Defaults to "Chiang Mai Immigration"'),
  deadlineKind: deadlineKind
    .optional()
    .describe("Which client deadline a case of this type resolves"),
  knownFailures: z.array(z.string().trim().min(1).max(300)).optional(),
  items: z.array(newItem).optional().describe("Checklist items, in order"),
});
export const updateTemplateInput = z.object({
  template: templateRef,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  office: z.string().trim().max(120).optional(),
  deadlineKind: deadlineKind.nullable().optional(),
  knownFailures: z
    .array(z.string().trim().min(1).max(300))
    .optional()
    .describe("Replaces the list on the draft"),
  notes: z.string().trim().max(2000).nullable().optional().describe("Change notes for the draft"),
});
export const addTemplateItemInput = newItem.extend({
  template: templateRef,
  position: z.number().int().min(1).optional().describe("1-based position; appended when omitted"),
});
export const updateTemplateItemInput = z.object({
  template: templateRef,
  itemId: id("Template item"),
  label: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  kind: itemKind.optional(),
  required: z.boolean().optional(),
  rules: rules.nullable().optional(),
  formFileId: id("Template file")
    .nullable()
    .optional()
    .describe("The form this item is filled from"),
});
export const removeTemplateItemInput = z.object({
  template: templateRef,
  itemId: id("Template item"),
});
export const reorderTemplateItemsInput = z.object({
  template: templateRef,
  itemIds: z.array(z.string().uuid()).min(1).describe("Every draft item id, in the new order"),
});
export const attachTemplateFileInput = z.object({
  template: templateRef,
  name: z.string().trim().min(1).max(200).describe('Display name, e.g. "TM.7 application"'),
  kind: fileKind,
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
  contentBase64: z.string().min(1).describe("File content, base64, up to 10 MB"),
  itemId: id("Template item").optional().describe("Link this file as the form for an item"),
});
export const createTemplateFileUploadInput = z.object({
  template: templateRef,
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES).describe("Up to 20 MB"),
});
export const confirmTemplateFileUploadInput = z.object({
  template: templateRef,
  uploadKey: z.string().min(1).describe("uploadKey returned by createTemplateFileUpload"),
  name: attachTemplateFileInput.shape.name,
  kind: fileKind,
  mimeType: z.string().trim().min(1),
  itemId: attachTemplateFileInput.shape.itemId,
});
export const removeTemplateFileInput = z.object({
  template: templateRef,
  fileId: id("Template file"),
});
export const publishTemplateVersionInput = z.object({
  template: templateRef,
  notes: z.string().trim().max(2000).optional().describe("What changed in this version"),
});
export const archiveTemplateInput = z.object({ template: templateRef });
export const discardTemplateDraftInput = z.object({ template: templateRef });

const versionInclude = {
  items: { orderBy: { position: "asc" } },
  files: { orderBy: { name: "asc" } },
} as const satisfies Prisma.TemplateVersionInclude;

async function loadTemplate(tx: Tx, ref: string) {
  const template = await tx.template.findUnique({
    where: templateWhere(ref),
    include: { versions: { include: versionInclude, orderBy: { version: "desc" } } },
  });
  if (!template) throw notFound("template", ref);
  return template;
}
type LoadedTemplate = Awaited<ReturnType<typeof loadTemplate>>;
type LoadedVersion = LoadedTemplate["versions"][number];

/**
 * Returns the template's draft, creating it from the published version when needed.
 * The id maps translate published item and file ids to their draft copies.
 */
async function ensureDraft(tx: Tx, ctx: Context, template: LoadedTemplate) {
  if (template.archivedAt) {
    throw new DomainError("CONFLICT", `Template ${template.slug} is archived.`);
  }
  const existing = template.versions.find((v) => v.status === "DRAFT");
  if (existing)
    return {
      draft: existing,
      itemIds: new Map<string, string>(),
      fileIds: new Map<string, string>(),
    };

  const base = template.versions.find((v) => v.status === "PUBLISHED") ?? template.versions[0];
  const created = await tx.templateVersion.create({
    data: {
      templateId: template.id,
      version: (template.versions[0]?.version ?? 0) + 1,
      status: "DRAFT",
      knownFailures: base?.knownFailures ?? [],
    },
  });

  const fileIds = new Map<string, string>();
  for (const file of base?.files ?? []) {
    const copy = await tx.templateFile.create({
      data: {
        versionId: created.id,
        name: file.name,
        kind: file.kind,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        fieldMap: (file.fieldMap ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    fileIds.set(file.id, copy.id);
  }

  const itemIds = new Map<string, string>();
  for (const item of base?.items ?? []) {
    const copy = await tx.templateItem.create({
      data: {
        versionId: created.id,
        position: item.position,
        label: item.label,
        description: item.description,
        kind: item.kind,
        required: item.required,
        rules: (item.rules ?? undefined) as Prisma.InputJsonValue | undefined,
        formFileId: item.formFileId ? (fileIds.get(item.formFileId) ?? null) : null,
      },
    });
    itemIds.set(item.id, copy.id);
  }

  await audit(tx, ctx, {
    action: "template.draft_created",
    entity: "Template",
    entityId: template.id,
    after: { version: created.version, fromVersion: base?.version ?? null },
  });

  const draft = await tx.templateVersion.findUniqueOrThrow({
    where: { id: created.id },
    include: versionInclude,
  });
  return { draft, itemIds, fileIds };
}

function draftItem(draft: LoadedVersion, itemIds: Map<string, string>, itemId: string) {
  const mapped = itemIds.get(itemId) ?? itemId;
  const item = draft.items.find((i) => i.id === mapped);
  if (!item) {
    throw new DomainError(
      "NOT_FOUND",
      `Item ${itemId} is not on the draft (version ${draft.version}). Read the draft with get_template version "draft" and use its item ids.`,
    );
  }
  return item;
}

async function renumber(tx: Tx, orderedIds: string[]) {
  for (const [index, itemId] of orderedIds.entries()) {
    await tx.templateItem.update({ where: { id: itemId }, data: { position: index + 1 } });
  }
}

async function draftResult(tx: Tx, templateId: string) {
  const template = await loadTemplate(tx, templateId);
  const draft = template.versions.find((v) => v.status === "DRAFT");
  return {
    ...templateSummaryDto(template),
    draft: draft ? templateVersionDto(draft) : null,
  };
}

export async function listTemplates(ctx: Context, raw: z.input<typeof listTemplatesInput>) {
  requireLevel(ctx, "templates", "view");
  const input = listTemplatesInput.parse(raw);
  const rows = await ctx.db.template.findMany({
    where: input.includeArchived ? {} : { archivedAt: null },
    include: { versions: { include: { _count: { select: { items: true } } } } },
    orderBy: { name: "asc" },
  });
  return { items: rows.map(templateSummaryDto) };
}

export async function getTemplate(ctx: Context, raw: z.input<typeof getTemplateInput>) {
  requireLevel(ctx, "templates", "view");
  const input = getTemplateInput.parse(raw);
  const template = await loadTemplate(ctx.db, input.template);
  const wanted = input.version ?? "published";
  const version =
    wanted === "draft"
      ? template.versions.find((v) => v.status === "DRAFT")
      : wanted === "published"
        ? (template.versions.find((v) => v.status === "PUBLISHED") ??
          template.versions.find((v) => v.status === "DRAFT"))
        : template.versions.find((v) => v.version === wanted);
  if (!version) throw notFound(`version ${String(wanted)} of template`, input.template);

  return {
    ...templateSummaryDto(template),
    versions: template.versions.map((v) => ({
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt?.toISOString() ?? null,
    })),
    selected: templateVersionDto(version),
  };
}

export async function createTemplate(ctx: Context, raw: z.input<typeof createTemplateInput>) {
  requireLevel(ctx, "templates", "edit");
  const input = createTemplateInput.parse(raw);
  const clash = await ctx.db.template.findUnique({ where: { slug: input.slug } });
  if (clash)
    throw new DomainError("CONFLICT", `A template with slug "${input.slug}" already exists.`);

  return ctx.db.$transaction(async (tx) => {
    const template = await tx.template.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        office: input.office,
        deadlineKind: input.deadlineKind,
        versions: {
          create: {
            version: 1,
            status: "DRAFT",
            knownFailures: input.knownFailures ?? [],
            items: {
              create: (input.items ?? []).map((item, index) => ({
                position: index + 1,
                label: item.label,
                description: item.description,
                kind: item.kind,
                required: item.required,
                rules: item.rules as Prisma.InputJsonValue | undefined,
              })),
            },
          },
        },
      },
    });
    await audit(tx, ctx, {
      action: "template.created",
      entity: "Template",
      entityId: template.id,
      after: input,
    });
    return draftResult(tx, template.id);
  });
}

export async function updateTemplate(ctx: Context, raw: z.input<typeof updateTemplateInput>) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, knownFailures, notes, ...fields } = updateTemplateInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    await tx.template.update({ where: { id: template.id }, data: fields });
    if (knownFailures !== undefined || notes !== undefined) {
      const { draft } = await ensureDraft(tx, ctx, template);
      await tx.templateVersion.update({ where: { id: draft.id }, data: { knownFailures, notes } });
    }
    await audit(tx, ctx, {
      action: "template.updated",
      entity: "Template",
      entityId: template.id,
      after: { ...fields, knownFailures, notes },
    });
    return draftResult(tx, template.id);
  });
}

export async function addTemplateItem(ctx: Context, raw: z.input<typeof addTemplateItemInput>) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, position, ...item } = addTemplateItemInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const { draft } = await ensureDraft(tx, ctx, template);
    const created = await tx.templateItem.create({
      data: {
        versionId: draft.id,
        position: draft.items.length + 1,
        label: item.label,
        description: item.description,
        kind: item.kind,
        required: item.required,
        rules: item.rules as Prisma.InputJsonValue | undefined,
      },
    });
    const order = draft.items.map((i) => i.id);
    const at = Math.min(Math.max((position ?? order.length + 1) - 1, 0), order.length);
    order.splice(at, 0, created.id);
    await renumber(tx, order);
    await audit(tx, ctx, {
      action: "template.item_added",
      entity: "Template",
      entityId: template.id,
      after: { itemId: created.id, ...item, position: at + 1 },
    });
    return draftResult(tx, template.id);
  });
}

export async function updateTemplateItem(
  ctx: Context,
  raw: z.input<typeof updateTemplateItemInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const {
    template: ref,
    itemId,
    formFileId,
    rules: itemRules,
    ...fields
  } = updateTemplateItemInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const { draft, itemIds, fileIds } = await ensureDraft(tx, ctx, template);
    const item = draftItem(draft, itemIds, itemId);
    let fileId: string | null | undefined = formFileId;
    if (formFileId) {
      fileId = fileIds.get(formFileId) ?? formFileId;
      if (!draft.files.some((f) => f.id === fileId))
        throw notFound("file on the draft", formFileId);
    }
    await tx.templateItem.update({
      where: { id: item.id },
      data: {
        ...fields,
        formFileId: fileId,
        rules:
          itemRules === undefined
            ? undefined
            : itemRules === null
              ? Prisma.DbNull
              : (itemRules as Prisma.InputJsonValue),
      },
    });
    await audit(tx, ctx, {
      action: "template.item_updated",
      entity: "Template",
      entityId: template.id,
      before: item,
      after: { ...fields, formFileId: fileId, rules: itemRules },
    });
    return draftResult(tx, template.id);
  });
}

export async function removeTemplateItem(
  ctx: Context,
  raw: z.input<typeof removeTemplateItemInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, itemId } = removeTemplateItemInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const { draft, itemIds } = await ensureDraft(tx, ctx, template);
    const item = draftItem(draft, itemIds, itemId);
    await tx.templateItem.delete({ where: { id: item.id } });
    await renumber(
      tx,
      draft.items.filter((i) => i.id !== item.id).map((i) => i.id),
    );
    await audit(tx, ctx, {
      action: "template.item_removed",
      entity: "Template",
      entityId: template.id,
      before: item,
    });
    return draftResult(tx, template.id);
  });
}

export async function reorderTemplateItems(
  ctx: Context,
  raw: z.input<typeof reorderTemplateItemsInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, itemIds: requested } = reorderTemplateItemsInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const { draft, itemIds } = await ensureDraft(tx, ctx, template);
    const order = requested.map((itemId) => draftItem(draft, itemIds, itemId).id);
    const all = new Set(draft.items.map((i) => i.id));
    if (order.length !== all.size || new Set(order).size !== all.size) {
      throw new DomainError(
        "VALIDATION",
        `List every draft item exactly once: the draft has ${all.size} items.`,
      );
    }
    await renumber(tx, order);
    await audit(tx, ctx, {
      action: "template.items_reordered",
      entity: "Template",
      entityId: template.id,
      after: { order },
    });
    return draftResult(tx, template.id);
  });
}

export async function attachTemplateFile(
  ctx: Context,
  raw: z.input<typeof attachTemplateFileInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const input = attachTemplateFileInput.parse(raw);
  const storage = requireStorage(ctx);
  const file = decodeBase64File(input.contentBase64, input.mimeType);
  const template = await loadTemplate(ctx.db, input.template);
  const key = `templates/${template.id}/${randomUUID()}/${safeFilename(input.filename)}`;
  await storage.put(key, file.bytes, input.mimeType);

  return recordTemplateFile(ctx, template.id, {
    name: input.name,
    kind: input.kind,
    storageKey: key,
    mimeType: input.mimeType,
    sizeBytes: file.bytes.byteLength,
    itemId: input.itemId,
  });
}

/** Adds a stored object to the draft as a file, optionally as the form for an item. */
function recordTemplateFile(
  ctx: Context,
  templateId: string,
  file: {
    name: string;
    kind: z.infer<typeof fileKind>;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    itemId?: string | undefined;
  },
) {
  return ctx.db.$transaction(async (tx) => {
    const fresh = await loadTemplate(tx, templateId);
    const { draft, itemIds } = await ensureDraft(tx, ctx, fresh);
    const created = await tx.templateFile.create({
      data: {
        versionId: draft.id,
        name: file.name,
        kind: file.kind,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });
    if (file.itemId) {
      const item = draftItem(draft, itemIds, file.itemId);
      await tx.templateItem.update({ where: { id: item.id }, data: { formFileId: created.id } });
    }
    await audit(tx, ctx, {
      action: "template.file_attached",
      entity: "Template",
      entityId: templateId,
      after: {
        fileId: created.id,
        name: file.name,
        kind: file.kind,
        sizeBytes: created.sizeBytes,
      },
    });
    return draftResult(tx, templateId);
  });
}

/** A presigned PUT link for a form or letter. Confirm with confirmTemplateFileUpload. */
export async function createTemplateFileUpload(
  ctx: Context,
  raw: z.input<typeof createTemplateFileUploadInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const input = createTemplateFileUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const storage = requireStorage(ctx);
  const template = await loadTemplate(ctx.db, input.template);
  if (template.archivedAt) {
    throw new DomainError("CONFLICT", `Template ${template.slug} is archived.`);
  }
  const uploadKey = `templates/${template.id}/${randomUUID()}/${safeFilename(input.filename)}`;
  return {
    uploadKey,
    uploadUrl: await storage.uploadUrl(uploadKey, input.mimeType, UPLOAD_URL_SECONDS),
    method: "PUT" as const,
    headers: { "Content-Type": input.mimeType },
    expiresInSeconds: UPLOAD_URL_SECONDS,
  };
}

export async function confirmTemplateFileUpload(
  ctx: Context,
  raw: z.input<typeof confirmTemplateFileUploadInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const input = confirmTemplateFileUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const storage = requireStorage(ctx);
  const template = await loadTemplate(ctx.db, input.template);
  const match = /^templates\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/[^/]+$/.exec(input.uploadKey);
  if (!match || match[1] !== template.id) {
    throw new DomainError("VALIDATION", "uploadKey does not belong to this template.");
  }
  if (await ctx.db.templateFile.findFirst({ where: { storageKey: input.uploadKey } })) {
    throw new DomainError("CONFLICT", "This upload was already attached.");
  }
  const size = await storage.size(input.uploadKey);
  if (size === null) {
    throw new DomainError("NOT_FOUND", "Nothing was uploaded to that uploadKey yet.");
  }
  if (size > MAX_UPLOAD_BYTES) {
    await storage.delete(input.uploadKey);
    throw new DomainError("VALIDATION", "The uploaded file is over 20 MB and was discarded.");
  }
  return recordTemplateFile(ctx, template.id, {
    name: input.name,
    kind: input.kind,
    storageKey: input.uploadKey,
    mimeType: input.mimeType,
    sizeBytes: size,
    itemId: input.itemId,
  });
}

export async function removeTemplateFile(
  ctx: Context,
  raw: z.input<typeof removeTemplateFileInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, fileId } = removeTemplateFileInput.parse(raw);
  const result = await ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const { draft, fileIds } = await ensureDraft(tx, ctx, template);
    const mapped = fileIds.get(fileId) ?? fileId;
    const file = draft.files.find((f) => f.id === mapped);
    if (!file) throw notFound("file on the draft", fileId);
    await tx.templateItem.updateMany({
      where: { formFileId: file.id },
      data: { formFileId: null },
    });
    await tx.templateFile.delete({ where: { id: file.id } });
    const stillUsed = await tx.templateFile.count({ where: { storageKey: file.storageKey } });
    await audit(tx, ctx, {
      action: "template.file_removed",
      entity: "Template",
      entityId: template.id,
      before: { fileId: file.id, name: file.name },
    });
    return {
      dto: await draftResult(tx, template.id),
      orphanKey: stillUsed ? null : file.storageKey,
    };
  });
  if (result.orphanKey && ctx.storage) await ctx.storage.delete(result.orphanKey).catch(() => {});
  return result.dto;
}

export async function publishTemplateVersion(
  ctx: Context,
  raw: z.input<typeof publishTemplateVersionInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref, notes } = publishTemplateVersionInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const draft = template.versions.find((v) => v.status === "DRAFT");
    if (!draft) throw new DomainError("CONFLICT", `${template.name} has no draft to publish.`);
    if (draft.items.length === 0) {
      throw new DomainError("GUARD_FAILED", "A template needs at least one checklist item.");
    }
    await tx.templateVersion.updateMany({
      where: { templateId: template.id, status: "PUBLISHED" },
      data: { status: "RETIRED" },
    });
    await tx.templateVersion.update({
      where: { id: draft.id },
      data: {
        status: "PUBLISHED",
        publishedAt: ctx.now(),
        publishedById: ctx.actor.employeeId,
        notes: notes ?? draft.notes,
      },
    });
    await audit(tx, ctx, {
      action: "template.published",
      entity: "Template",
      entityId: template.id,
      after: { version: draft.version, notes },
    });
    const updated = await loadTemplate(tx, template.id);
    const published = updated.versions.find((v) => v.status === "PUBLISHED");
    return {
      ...templateSummaryDto(updated),
      published: published ? templateVersionDto(published) : null,
    };
  });
}

/** Throws the draft away. The published version stays current. */
export async function discardTemplateDraft(
  ctx: Context,
  raw: z.input<typeof discardTemplateDraftInput>,
) {
  requireLevel(ctx, "templates", "edit");
  const { template: ref } = discardTemplateDraftInput.parse(raw);
  const result = await ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    const draft = template.versions.find((v) => v.status === "DRAFT");
    if (!draft) throw new DomainError("CONFLICT", `${template.name} has no draft.`);
    if (template.versions.length === 1) {
      throw new DomainError(
        "CONFLICT",
        `${template.name} has never been published, so the draft is all there is. Archive the template instead.`,
      );
    }
    await tx.templateItem.deleteMany({ where: { versionId: draft.id } });
    await tx.templateFile.deleteMany({ where: { versionId: draft.id } });
    await tx.templateVersion.delete({ where: { id: draft.id } });
    const keys = draft.files.map((f) => f.storageKey);
    const kept = await tx.templateFile.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    });
    await audit(tx, ctx, {
      action: "template.draft_discarded",
      entity: "Template",
      entityId: template.id,
      before: { version: draft.version },
    });
    return {
      dto: templateSummaryDto(await loadTemplate(tx, template.id)),
      orphanKeys: keys.filter((k) => !kept.some((f) => f.storageKey === k)),
    };
  });
  for (const key of result.orphanKeys) await ctx.storage?.delete(key).catch(() => {});
  return result.dto;
}

export async function archiveTemplate(ctx: Context, raw: z.input<typeof archiveTemplateInput>) {
  requireLevel(ctx, "templates", "full");
  const { template: ref } = archiveTemplateInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const template = await loadTemplate(tx, ref);
    await tx.template.update({ where: { id: template.id }, data: { archivedAt: ctx.now() } });
    await audit(tx, ctx, {
      action: "template.archived",
      entity: "Template",
      entityId: template.id,
    });
    return templateSummaryDto(await loadTemplate(tx, template.id));
  });
}
