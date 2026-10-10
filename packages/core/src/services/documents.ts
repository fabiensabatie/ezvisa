import { randomUUID } from "node:crypto";
import type { Prisma } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireLevel, requireStorage, type Tx } from "../context.js";
import { documentDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { caseRef, caseWhere, id, notFound } from "../refs.js";
import {
  assertMimeType,
  decodeBase64File,
  MAX_UPLOAD_BYTES,
  safeFilename,
  sha256Hex,
} from "./files.js";

const DOWNLOAD_URL_SECONDS = 5 * 60;
const UPLOAD_URL_SECONDS = 10 * 60;

const attachTo = {
  case: caseRef.optional().describe("Attach to this case"),
  caseItemId: id("Case item")
    .optional()
    .describe("Attach to this checklist item. A MISSING item becomes RECEIVED."),
};

export const listDocumentsInput = z.object({
  clientId: id("Client").optional(),
  case: caseRef.optional(),
});
export const getDocumentInput = z.object({ documentId: id("Document") });
export const uploadDocumentInput = z.object({
  clientId: id("Client"),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).describe("application/pdf, image/jpeg, image/png, …"),
  contentBase64: z.string().min(1).describe("File content, base64, up to 10 MB"),
  ...attachTo,
});
export const createDocumentUploadInput = z.object({
  clientId: id("Client"),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES).describe("Up to 20 MB"),
});
export const confirmDocumentUploadInput = z.object({
  uploadKey: z.string().min(1).describe("uploadKey returned by create_document_upload"),
  clientId: id("Client"),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
  ...attachTo,
});
export const updateDocumentInput = z.object({
  documentId: id("Document"),
  extracted: z
    .record(z.string(), z.unknown())
    .describe("Fields read from the document, e.g. passport number and expiry"),
});
export const deleteDocumentInput = z.object({ documentId: id("Document") });

async function consentingClient(ctx: Context, clientId: string) {
  const client = await ctx.db.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client) throw notFound("client", clientId);
  if (!client.consentAt) {
    throw new DomainError(
      "GUARD_FAILED",
      `${client.fullName} has not accepted the privacy notice yet. Record consent with update_client (consentGiven: true) before storing documents.`,
    );
  }
  return client;
}

/** Resolves where a new document attaches, checking it belongs to the client. */
async function resolveAttachment(
  ctx: Context,
  clientId: string,
  input: { case?: string | undefined; caseItemId?: string | undefined },
) {
  if (!input.case && !input.caseItemId) return { caseId: null, caseItem: null };
  if (input.caseItemId) {
    const item = await ctx.db.caseItem.findUnique({
      where: { id: input.caseItemId },
      include: { case: true },
    });
    if (!item || item.case.clientId !== clientId)
      throw notFound("checklist item for this client", input.caseItemId);
    return { caseId: item.caseId, caseItem: item };
  }
  const found = await ctx.db.case.findUnique({ where: caseWhere(input.case ?? "") });
  if (!found || found.clientId !== clientId)
    throw notFound("case for this client", input.case ?? "");
  return { caseId: found.id, caseItem: null };
}

async function createDocumentRow(
  tx: Tx,
  ctx: Context,
  data: Prisma.DocumentUncheckedCreateInput,
  caseItem: { id: string; status: string } | null,
) {
  const document = await tx.document.create({ data });
  if (caseItem && caseItem.status === "MISSING") {
    await tx.caseItem.update({
      where: { id: caseItem.id },
      data: { status: "RECEIVED", updatedById: ctx.actor.employeeId },
    });
  }
  await audit(tx, ctx, {
    action: "document.uploaded",
    entity: "Document",
    entityId: document.id,
    after: documentDto(document),
  });
  return documentDto(document);
}

export async function listDocuments(ctx: Context, raw: z.input<typeof listDocumentsInput>) {
  requireLevel(ctx, "documents", "view");
  const input = listDocumentsInput.parse(raw);
  if (!input.clientId && !input.case) {
    throw new DomainError("VALIDATION", "Give a clientId or a case.");
  }
  const caseRow = input.case
    ? await ctx.db.case.findUnique({ where: caseWhere(input.case) })
    : null;
  if (input.case && !caseRow) throw notFound("case", input.case);
  const rows = await ctx.db.document.findMany({
    where: {
      deletedAt: null,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(caseRow ? { caseId: caseRow.id } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return { items: rows.map(documentDto) };
}

async function findDocument(ctx: Context, documentId: string) {
  const document = await ctx.db.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!document) throw notFound("document", documentId);
  return document;
}

export async function getDocument(ctx: Context, raw: z.input<typeof getDocumentInput>) {
  requireLevel(ctx, "documents", "view");
  const { documentId } = getDocumentInput.parse(raw);
  const document = await findDocument(ctx, documentId);
  const storage = requireStorage(ctx);
  const downloadUrl = await storage.downloadUrl(
    document.storageKey,
    document.filename,
    DOWNLOAD_URL_SECONDS,
  );
  await audit(ctx.db, ctx, {
    action: "document.url_issued",
    entity: "Document",
    entityId: documentId,
  });
  return {
    ...documentDto(document),
    downloadUrl,
    downloadUrlExpiresInSeconds: DOWNLOAD_URL_SECONDS,
  };
}

/** Returns the file bytes so an assistant can read the document itself. Audited. */
export async function readDocument(ctx: Context, raw: z.input<typeof getDocumentInput>) {
  requireLevel(ctx, "documents", "view");
  const { documentId } = getDocumentInput.parse(raw);
  const document = await findDocument(ctx, documentId);
  const bytes = await requireStorage(ctx).get(document.storageKey);
  await audit(ctx.db, ctx, { action: "document.read", entity: "Document", entityId: documentId });
  return { document: documentDto(document), bytes };
}

export async function uploadDocument(ctx: Context, raw: z.input<typeof uploadDocumentInput>) {
  requireLevel(ctx, "documents", "edit");
  const input = uploadDocumentInput.parse(raw);
  const storage = requireStorage(ctx);
  await consentingClient(ctx, input.clientId);
  const file = decodeBase64File(input.contentBase64, input.mimeType);
  const target = await resolveAttachment(ctx, input.clientId, input);

  const documentId = randomUUID();
  const storageKey = `clients/${input.clientId}/${documentId}/${safeFilename(input.filename)}`;
  await storage.put(storageKey, file.bytes, input.mimeType);

  return ctx.db.$transaction((tx) =>
    createDocumentRow(
      tx,
      ctx,
      {
        id: documentId,
        clientId: input.clientId,
        caseId: target.caseId,
        caseItemId: target.caseItem?.id ?? null,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: file.bytes.byteLength,
        sha256: file.sha256,
        storageKey,
        uploadedById: ctx.actor.employeeId,
      },
      target.caseItem,
    ),
  );
}

export async function createDocumentUpload(
  ctx: Context,
  raw: z.input<typeof createDocumentUploadInput>,
) {
  requireLevel(ctx, "documents", "edit");
  const input = createDocumentUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const storage = requireStorage(ctx);
  await consentingClient(ctx, input.clientId);
  const uploadKey = `clients/${input.clientId}/${randomUUID()}/${safeFilename(input.filename)}`;
  const uploadUrl = await storage.uploadUrl(uploadKey, input.mimeType, UPLOAD_URL_SECONDS);
  return {
    uploadKey,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": input.mimeType },
    expiresInSeconds: UPLOAD_URL_SECONDS,
    next: "PUT the file to uploadUrl, then call confirm_document_upload with the same uploadKey.",
  };
}

export async function confirmDocumentUpload(
  ctx: Context,
  raw: z.input<typeof confirmDocumentUploadInput>,
) {
  requireLevel(ctx, "documents", "edit");
  const input = confirmDocumentUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const storage = requireStorage(ctx);
  await consentingClient(ctx, input.clientId);

  const match = /^clients\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[^/]+$/.exec(input.uploadKey);
  if (!match || match[1] !== input.clientId) {
    throw new DomainError("VALIDATION", "uploadKey does not belong to this client.");
  }
  const documentId = match[2] ?? randomUUID();
  if (await ctx.db.document.findUnique({ where: { storageKey: input.uploadKey } })) {
    throw new DomainError("CONFLICT", "This upload was already confirmed.");
  }
  const size = await storage.size(input.uploadKey);
  if (size === null)
    throw new DomainError("NOT_FOUND", "Nothing was uploaded to that uploadKey yet.");
  if (size > MAX_UPLOAD_BYTES) {
    await storage.delete(input.uploadKey);
    throw new DomainError("VALIDATION", "The uploaded file is over 20 MB and was discarded.");
  }
  const bytes = await storage.get(input.uploadKey);
  const target = await resolveAttachment(ctx, input.clientId, input);

  return ctx.db.$transaction((tx) =>
    createDocumentRow(
      tx,
      ctx,
      {
        id: documentId,
        clientId: input.clientId,
        caseId: target.caseId,
        caseItemId: target.caseItem?.id ?? null,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: size,
        sha256: sha256Hex(bytes),
        storageKey: input.uploadKey,
        uploadedById: ctx.actor.employeeId,
      },
      target.caseItem,
    ),
  );
}

export async function updateDocument(ctx: Context, raw: z.input<typeof updateDocumentInput>) {
  requireLevel(ctx, "documents", "edit");
  const { documentId, extracted } = updateDocumentInput.parse(raw);
  const before = await findDocument(ctx, documentId);
  return ctx.db.$transaction(async (tx) => {
    const document = await tx.document.update({
      where: { id: documentId },
      data: { extracted: extracted as Prisma.InputJsonValue },
    });
    await audit(tx, ctx, {
      action: "document.extracted",
      entity: "Document",
      entityId: documentId,
      before: before.extracted,
      after: extracted,
    });
    return documentDto(document);
  });
}

export async function deleteDocument(ctx: Context, raw: z.input<typeof deleteDocumentInput>) {
  requireLevel(ctx, "documents", "full");
  const { documentId } = deleteDocumentInput.parse(raw);
  const document = await findDocument(ctx, documentId);
  return ctx.db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { deletedAt: ctx.now() } });
    await audit(tx, ctx, {
      action: "document.deleted",
      entity: "Document",
      entityId: documentId,
      before: documentDto(document),
    });
    return { deleted: true as const, documentId };
  });
}
