import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "@ezvisa/db";
import { z } from "zod";
import { audit, auditClient } from "../audit.js";
import { type Context, type FormJobs, requireLevel } from "../context.js";
import { bangkokToday, formatDateOnly, formatShortDate } from "../dates.js";
import { documentDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { caseNumber, caseRef, caseWhere, id, notFound } from "../refs.js";
import type { Storage } from "../storage.js";
import { hashToken } from "../tokens.js";
import { assertMimeType, MAX_UPLOAD_BYTES, safeFilename, sha256Hex } from "./files.js";
import { readPublicSettings } from "./settings.js";

// A client receives a link to upload the documents their case needs, without an account.
// The link's secret is 32 random bytes; only its SHA-256 is stored. It travels in the URL
// fragment (after #), which browsers never send to the server, so it stays out of logs.

const DAY_MS = 86_400_000;
const UPLOAD_URL_SECONDS = 10 * 60;
/** A generous ceiling against abuse: a checklist rarely needs more than a few dozen files. */
const MAX_UPLOADS_PER_LINK = 100;
/** Links to open an uploaded file last five minutes, as in the dashboard. */
const FILE_URL_SECONDS = 5 * 60;
/** Wrong dates of birth before viewing files locks for a day. */
const MAX_VIEW_FAILURES = 3;

// ---- staff: share and revoke -------------------------------------------------------------

export const createUploadLinkInput = z.object({
  case: caseRef,
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(14)
    .describe("How long the link works, in days"),
});
export const revokeUploadLinkInput = z.object({ case: caseRef });

/**
 * Creates the link a client opens to upload what the checklist asks of them, and replaces
 * any earlier link for the case. Returns the link and a message ready to send.
 */
export async function createUploadLink(ctx: Context, raw: z.input<typeof createUploadLinkInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = createUploadLinkInput.parse(raw);
  const kase = await ctx.db.case.findUnique({
    where: caseWhere(input.case),
    include: { client: true, items: true, templateVersion: { include: { template: true } } },
  });
  if (!kase) throw notFound("case", input.case);
  if (kase.stage === "DONE" || kase.stage === "CANCELLED") {
    throw new DomainError("CONFLICT", `${caseNumber(kase.number)} is closed (${kase.stage}).`);
  }
  const items = kase.items.filter((i) => i.clientUpload).sort((a, b) => a.position - b.position);
  if (items.length === 0) {
    throw new DomainError(
      "CONFLICT",
      "Nothing on this case's checklist is set for the client to upload. Tick \"The client uploads it\" on the template's items, or ask for the documents another way.",
    );
  }

  const secret = randomBytes(32).toString("base64url");
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS);
  const link = await ctx.db.$transaction(async (tx) => {
    // One link at a time: sharing again replaces the previous one.
    await tx.caseShareLink.updateMany({
      where: { caseId: kase.id, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.caseShareLink.create({
      data: {
        caseId: kase.id,
        hash: hashToken(secret),
        createdById: ctx.actor.employeeId,
        expiresAt,
      },
    });
    await audit(tx, ctx, {
      action: "case.upload_link_created",
      entity: "Case",
      entityId: kase.id,
      after: { linkId: created.id, expiresAt, items: items.map((i) => i.label) },
    });
    return created;
  });

  const url = `${(ctx.appUrl ?? "").replace(/\/+$/, "")}/upload#${secret}`;
  const { agentName } = await readPublicSettings(ctx.db);
  const firstName = kase.client.fullName.split(/\s+/)[0] ?? kase.client.fullName;
  const until = formatShortDate(bangkokToday(expiresAt));
  return {
    url,
    linkId: link.id,
    expiresAt: expiresAt.toISOString(),
    items: items.map((i) => i.label),
    message: `Hi ${firstName}, please upload the documents for your ${kase.templateVersion.template.name} here: ${url}\nThe link works until ${until}. ${agentName}`,
    ...(ctx.appUrl
      ? {}
      : { note: "APP_URL is not set on the server, so the link has no address in front of it." }),
  };
}

/** Stops the case's link from working. */
export async function revokeUploadLink(ctx: Context, raw: z.input<typeof revokeUploadLinkInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = revokeUploadLinkInput.parse(raw);
  const kase = await ctx.db.case.findUnique({ where: caseWhere(input.case) });
  if (!kase) throw notFound("case", input.case);
  return ctx.db.$transaction(async (tx) => {
    const { count } = await tx.caseShareLink.updateMany({
      where: { caseId: kase.id, revokedAt: null },
      data: { revokedAt: ctx.now() },
    });
    if (count > 0) {
      await audit(tx, ctx, {
        action: "case.upload_link_revoked",
        entity: "Case",
        entityId: kase.id,
      });
    }
    return { revoked: count };
  });
}

// ---- client: the upload page ----------------------------------------------------------------

/** What the client side needs: no actor, only the link's secret. */
export type ClientContext = {
  db: Db;
  storage: Storage | null;
  now: () => Date;
  /** Fills the case's forms once the client has sent everything asked. */
  formJobs?: FormJobs | null;
};

export const linkInput = z.object({ secret: z.string().min(20).max(100) });
export const clientUploadInput = linkInput.extend({
  itemId: id("Checklist item"),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});
export const confirmClientUploadInput = linkInput.extend({
  itemId: id("Checklist item"),
  uploadKey: z.string().min(1),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1),
});

const invalidLink = () =>
  new DomainError(
    "NOT_FOUND",
    "This link has expired or was replaced. Ask your visa agent for a new one.",
  );

async function openLink(c: ClientContext, secret: string) {
  const link = await c.db.caseShareLink.findUnique({
    where: { hash: hashToken(secret) },
    include: {
      case: {
        include: {
          client: true,
          items: {
            orderBy: { position: "asc" },
            include: { documents: { where: { deletedAt: null }, select: { id: true } } },
          },
          templateVersion: {
            include: { template: true, items: { select: { id: true, description: true } } },
          },
        },
      },
    },
  });
  if (!link || link.revokedAt || link.expiresAt <= c.now()) throw invalidLink();
  if (link.case.stage === "DONE" || link.case.stage === "CANCELLED") throw invalidLink();
  return link;
}
type OpenLink = Awaited<ReturnType<typeof openLink>>;

/** Where an item stands, in the client's terms. */
function clientState(status: string): "needed" | "again" | "received" | "done" {
  if (status === "MISSING") return "needed";
  if (status === "FLAGGED") return "again";
  if (status === "RECEIVED") return "received";
  return "done";
}

async function pageFor(c: ClientContext, link: OpenLink) {
  const { agentName, accent } = await readPublicSettings(c.db);
  const descriptions = new Map(link.case.templateVersion.items.map((i) => [i.id, i.description]));
  const { client } = link.case;
  return {
    agentName,
    accent,
    firstName: client.fullName.split(/\s+/)[0] ?? client.fullName,
    caseType: link.case.templateVersion.template.name,
    expiresAt: link.expiresAt.toISOString(),
    consentGiven: client.consentAt !== null,
    /** Files can be shown once the client confirms their date of birth, so one must be on file. */
    canViewFiles: client.dateOfBirth !== null,
    items: link.case.items
      .filter((i) => i.clientUpload)
      .map((i) => ({
        id: i.id,
        label: i.label,
        description: i.templateItemId ? (descriptions.get(i.templateItemId) ?? null) : null,
        required: i.required,
        state: clientState(i.status),
        files: i.documents.length,
      })),
  };
}

/** The upload page: who it is for and what is asked. Nothing else about the case. */
export async function viewUploadPage(c: ClientContext, raw: z.input<typeof linkInput>) {
  const { secret } = linkInput.parse(raw);
  return pageFor(c, await openLink(c, secret));
}

/** The client accepts the privacy notice, which documents need first (PDPA). */
export async function acceptPrivacyNotice(c: ClientContext, raw: z.input<typeof linkInput>) {
  const { secret } = linkInput.parse(raw);
  const link = await openLink(c, secret);
  if (!link.case.client.consentAt) {
    await c.db.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: link.case.clientId },
        data: { consentAt: c.now() },
      });
      await auditClient(tx, {
        action: "client.consent_given",
        entity: "Client",
        entityId: link.case.clientId,
        after: { through: "upload link", linkId: link.id },
      });
    });
  }
  return pageFor(c, await openLink(c, secret));
}

function uploadableItem(link: OpenLink, itemId: string) {
  if (!link.case.client.consentAt) {
    throw new DomainError("GUARD_FAILED", "Please accept the privacy notice first.");
  }
  const item = link.case.items.find((i) => i.id === itemId && i.clientUpload);
  if (!item) throw new DomainError("NOT_FOUND", "This document is not on your list.");
  if (item.status === "VERIFIED" || item.status === "WAIVED") {
    throw new DomainError("CONFLICT", `${item.label} is already done. Nothing more is needed.`);
  }
  if (link.uploads >= MAX_UPLOADS_PER_LINK) {
    throw new DomainError("CONFLICT", "This link has reached its upload limit. Ask your agent.");
  }
  return item;
}

/** A 10-minute link the client's browser PUTs the file to, straight to storage. */
export async function createClientUpload(c: ClientContext, raw: z.input<typeof clientUploadInput>) {
  const input = clientUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const link = await openLink(c, input.secret);
  uploadableItem(link, input.itemId);
  if (!c.storage) throw new DomainError("CONFLICT", "Uploads are not available right now.");
  const uploadKey = `clients/${link.case.clientId}/${randomUUID()}/${safeFilename(input.filename)}`;
  return {
    uploadKey,
    uploadUrl: await c.storage.uploadUrl(uploadKey, input.mimeType, UPLOAD_URL_SECONDS),
    headers: { "Content-Type": input.mimeType },
  };
}

/**
 * Files the uploaded document under the checklist item. A missing item, or one flagged
 * for a new copy, becomes RECEIVED for the team to check.
 */
export async function confirmClientUpload(
  c: ClientContext,
  raw: z.input<typeof confirmClientUploadInput>,
) {
  const input = confirmClientUploadInput.parse(raw);
  assertMimeType(input.mimeType);
  const link = await openLink(c, input.secret);
  const item = uploadableItem(link, input.itemId);
  const storage = c.storage;
  if (!storage) throw new DomainError("CONFLICT", "Uploads are not available right now.");

  const match = /^clients\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[^/]+$/.exec(input.uploadKey);
  if (!match || match[1] !== link.case.clientId || !match[2]) {
    throw new DomainError("VALIDATION", "That upload does not belong to this link.");
  }
  const documentId = match[2];
  if (await c.db.document.findUnique({ where: { storageKey: input.uploadKey } })) {
    throw new DomainError("CONFLICT", "This file was already received.");
  }
  const size = await storage.size(input.uploadKey);
  if (size === null) throw new DomainError("NOT_FOUND", "The file did not arrive. Try again.");
  if (size > MAX_UPLOAD_BYTES) {
    await storage.delete(input.uploadKey);
    throw new DomainError("VALIDATION", "The file is over 20 MB. Send a smaller copy.");
  }
  const bytes = await storage.get(input.uploadKey);
  const now = c.now();

  await c.db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        id: documentId,
        clientId: link.case.clientId,
        caseId: link.caseId,
        caseItemId: item.id,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: size,
        sha256: sha256Hex(bytes),
        storageKey: input.uploadKey,
        uploadedById: null,
        uploadedViaLinkId: link.id,
      },
    });
    if (item.status === "MISSING" || item.status === "FLAGGED") {
      await tx.caseItem.update({
        where: { id: item.id },
        data: {
          status: "RECEIVED",
          note: item.status === "FLAGGED" ? "New copy uploaded by the client." : item.note,
          flaggedByKind: null,
        },
      });
    }
    await tx.caseShareLink.update({
      where: { id: link.id },
      data: { uploads: { increment: 1 }, lastUsedAt: now },
    });
    await auditClient(tx, {
      action: "document.uploaded",
      entity: "Document",
      entityId: document.id,
      after: { ...documentDto(document), through: "upload link", linkId: link.id },
    });
  });
  const after = await openLink(c, input.secret);
  if (allSent(after)) c.formJobs?.prepareCase(after.caseId);
  return pageFor(c, after);
}

/** Every required item the client was asked for is in: forms can be filled. */
function allSent(link: OpenLink): boolean {
  const asked = link.case.items.filter((i) => i.clientUpload && i.required);
  return asked.length > 0 && asked.every((i) => i.status !== "MISSING" && i.status !== "FLAGGED");
}

// ---- client: their uploaded files, behind their date of birth ---------------------------------

export const viewFilesInput = linkInput.extend({
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth.")
    .describe("The client's date of birth, YYYY-MM-DD"),
});
export const clientFileInput = viewFilesInput.extend({
  documentId: z.string().uuid(),
  download: z.boolean().default(false),
});
export const removeClientFileInput = viewFilesInput.extend({ documentId: z.string().uuid() });

/**
 * Opens the link for viewing files: the client's date of birth must match. Three wrong dates
 * in a day lock viewing for that link, so a forwarded link alone shows nothing.
 */
async function unlock(c: ClientContext, secret: string, dateOfBirth: string) {
  const link = await openLink(c, secret);
  const now = c.now();
  const recent =
    link.viewFailedAt && now.getTime() - link.viewFailedAt.getTime() < DAY_MS
      ? link.viewFailures
      : 0;
  if (recent >= MAX_VIEW_FAILURES) {
    throw new DomainError(
      "FORBIDDEN",
      "Too many tries. Try again tomorrow, or ask your visa agent to check your files.",
    );
  }
  const onFile = link.case.client.dateOfBirth;
  if (!onFile) {
    throw new DomainError(
      "CONFLICT",
      "Your date of birth is not on file yet, so your files cannot be shown here. Ask your visa agent.",
    );
  }
  if (formatDateOnly(onFile) !== dateOfBirth) {
    const failures = recent + 1;
    await c.db.caseShareLink.update({
      where: { id: link.id },
      data: { viewFailures: failures, viewFailedAt: now },
    });
    throw new DomainError(
      "VALIDATION",
      failures >= MAX_VIEW_FAILURES
        ? "That date does not match. Viewing is locked until tomorrow."
        : `That date does not match. ${MAX_VIEW_FAILURES - failures} ${MAX_VIEW_FAILURES - failures === 1 ? "try" : "tries"} left.`,
    );
  }
  if (link.viewFailures > 0) {
    await c.db.caseShareLink.update({ where: { id: link.id }, data: { viewFailures: 0 } });
  }
  return link;
}

/** The files the client uploaded through this case's links: never what the team added. */
function clientFiles(c: ClientContext, link: OpenLink) {
  return c.db.document.findMany({
    where: { caseId: link.caseId, deletedAt: null, uploadedVia: { caseId: link.caseId } },
    orderBy: { createdAt: "asc" },
  });
}

const changeable = (status: string) => status !== "VERIFIED" && status !== "WAIVED";

async function filesFor(c: ClientContext, link: OpenLink) {
  const files = await clientFiles(c, link);
  return {
    items: link.case.items
      .filter((i) => i.clientUpload)
      .map((i) => ({
        itemId: i.id,
        label: i.label,
        state: clientState(i.status),
        canChange: changeable(i.status),
        files: files
          .filter((f) => f.caseItemId === i.id)
          .map((f) => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            uploadedAt: f.createdAt.toISOString(),
          })),
      })),
  };
}

/** The client's uploaded files, item by item, once their date of birth matches. */
export async function listClientFiles(c: ClientContext, raw: z.input<typeof viewFilesInput>) {
  const input = viewFilesInput.parse(raw);
  return filesFor(c, await unlock(c, input.secret, input.dateOfBirth));
}

async function clientFile(c: ClientContext, link: OpenLink, documentId: string) {
  const file = (await clientFiles(c, link)).find((f) => f.id === documentId);
  if (!file) throw new DomainError("NOT_FOUND", "This file is not one you uploaded here.");
  return file;
}

/** A five-minute link to see or save one of the client's own files. Audited. */
export async function clientFileLink(c: ClientContext, raw: z.input<typeof clientFileInput>) {
  const input = clientFileInput.parse(raw);
  const link = await unlock(c, input.secret, input.dateOfBirth);
  const file = await clientFile(c, link, input.documentId);
  if (!c.storage) throw new DomainError("CONFLICT", "Files are not available right now.");
  const url = await c.storage.downloadUrl(
    file.storageKey,
    file.filename,
    FILE_URL_SECONDS,
    input.download ? "attachment" : "inline",
  );
  await auditClient(c.db, {
    action: "document.read",
    entity: "Document",
    entityId: file.id,
    after: { through: "upload link", linkId: link.id },
  });
  return { url };
}

/**
 * Removes one of the client's files, for a wrong or blurry upload, until the team has
 * verified the item. An item left without any file goes back to missing.
 */
export async function removeClientFile(
  c: ClientContext,
  raw: z.input<typeof removeClientFileInput>,
) {
  const input = removeClientFileInput.parse(raw);
  const link = await unlock(c, input.secret, input.dateOfBirth);
  const file = await clientFile(c, link, input.documentId);
  const item = link.case.items.find((i) => i.id === file.caseItemId);
  if (item && !changeable(item.status)) {
    throw new DomainError(
      "CONFLICT",
      `${item.label} is already checked. Ask your visa agent to change it.`,
    );
  }
  await c.db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: file.id }, data: { deletedAt: c.now() } });
    if (item && item.status === "RECEIVED") {
      const left = await tx.document.count({ where: { caseItemId: item.id, deletedAt: null } });
      if (left === 0) {
        await tx.caseItem.update({
          where: { id: item.id },
          data: { status: "MISSING", note: "The client removed their upload." },
        });
      }
    }
    await auditClient(tx, {
      action: "document.deleted",
      entity: "Document",
      entityId: file.id,
      before: { ...documentDto(file), through: "upload link", linkId: link.id },
    });
  });
  const fresh = await openLink(c, input.secret);
  return { page: await pageFor(c, fresh), files: await filesFor(c, fresh) };
}
