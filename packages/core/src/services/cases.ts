import type { CaseItem, Prisma } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireHuman, requireLevel, type Tx } from "../context.js";
import { dateOnly, parseDateOnly } from "../dates.js";
import { caseDetailDto, caseItemDto, caseSummaryDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { pageArgs, pageInput, toPage } from "../pagination.js";
import {
  caseNumber,
  caseRef,
  caseWhere,
  id,
  notFound,
  templateRef,
  templateWhere,
} from "../refs.js";

const OPEN_STAGES = ["NEW", "COLLECTING", "DRAFTING", "VALIDATION", "SUBMISSION"] as const;
const openStage = z.enum(OPEN_STAGES);
const itemStatus = z.enum(["MISSING", "RECEIVED", "VERIFIED", "FLAGGED", "WAIVED"]);

export const listCasesInput = z.object({
  stage: z.enum([...OPEN_STAGES, "DONE", "CANCELLED"]).optional(),
  assigneeId: id("Employee").optional(),
  clientId: id("Client").optional(),
  dueBefore: dateOnly.optional().describe("Only cases due on or before this date"),
  includeClosed: z.boolean().default(false).describe("Include DONE and CANCELLED cases"),
  ...pageInput,
});
export const getCaseInput = z.object({ case: caseRef });
export const createCaseInput = z.object({
  clientId: id("Client"),
  template: templateRef,
  assigneeId: id("Employee").optional(),
  dueDate: dateOnly.optional().describe("Target date at immigration, YYYY-MM-DD"),
  notes: z.string().max(5000).optional(),
});
export const updateCaseInput = z.object({
  case: caseRef,
  assigneeId: id("Employee").nullable().optional(),
  dueDate: dateOnly.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export const moveCaseStageInput = z.object({
  case: caseRef,
  stage: openStage.describe("Target stage. Use close_case to finish or cancel a case."),
  note: z.string().trim().max(2000).optional(),
});
export const updateCaseItemInput = z.object({
  case: caseRef,
  itemId: id("Checklist item"),
  status: itemStatus.optional().describe("VERIFIED and WAIVED can only be set by a person"),
  note: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .describe("Reason, required for FLAGGED and WAIVED, e.g. 'photo background is grey'"),
  documentIds: z
    .array(z.string().uuid())
    .optional()
    .describe("Documents of this client that satisfy the item"),
});
export const closeCaseInput = z.object({
  case: caseRef,
  outcome: z
    .enum(["APPROVED", "REJECTED", "MORE_DOCUMENTS", "WITHDRAWN"])
    .describe(
      "APPROVED or REJECTED closes a submitted case. MORE_DOCUMENTS sends it back to COLLECTING. WITHDRAWN cancels it.",
    ),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe("Required for MORE_DOCUMENTS and WITHDRAWN"),
});

const caseInclude = {
  client: true,
  assignee: true,
  templateVersion: { include: { template: true } },
  items: { include: { documents: { where: { deletedAt: null }, select: { id: true } } } },
} as const satisfies Prisma.CaseInclude;

const detailInclude = {
  ...caseInclude,
  documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
} as const satisfies Prisma.CaseInclude;

async function loadCase(tx: Tx, ref: string) {
  const row = await tx.case.findUnique({ where: caseWhere(ref), include: detailInclude });
  if (!row) throw notFound("case", ref);
  return row;
}

function assertOpen(row: { stage: string; number: number }) {
  if (row.stage === "DONE" || row.stage === "CANCELLED") {
    throw new DomainError("CONFLICT", `${caseNumber(row.number)} is closed (${row.stage}).`);
  }
}

async function assertAssignee(tx: Tx, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const employee = await tx.employee.findUnique({ where: { id: assigneeId } });
  if (!employee?.active) throw notFound("active employee", assigneeId);
}

function labels(items: CaseItem[]) {
  return items.map((i) => `"${i.label}" (${i.status})`).join(", ");
}

/** The rules from spec section 4.3. Throws GUARD_FAILED with what blocks the move. */
function checkStageGuards(ctx: Context, target: string, items: CaseItem[], number: number) {
  const required = items.filter((i) => i.required);
  if (target === "VALIDATION") {
    const missing = required.filter((i) => !["RECEIVED", "VERIFIED", "WAIVED"].includes(i.status));
    if (missing.length) {
      throw new DomainError(
        "GUARD_FAILED",
        `Cannot move ${caseNumber(number)} to VALIDATION: ${labels(missing)} still need attention.`,
      );
    }
  }
  if (target === "SUBMISSION") {
    if (!ctx.actor.permissions.approvePacks) {
      throw new DomainError("FORBIDDEN", `The ${ctx.actor.roleName} role cannot approve packs.`);
    }
    requireHuman(ctx, "approve a pack for submission");
    const flagged = items.filter((i) => i.status === "FLAGGED");
    if (flagged.length) {
      throw new DomainError(
        "GUARD_FAILED",
        `Cannot move ${caseNumber(number)} to SUBMISSION: ${labels(flagged)} flagged.`,
      );
    }
    const unverified = required.filter((i) => !["VERIFIED", "WAIVED"].includes(i.status));
    if (unverified.length) {
      throw new DomainError(
        "GUARD_FAILED",
        `Cannot move ${caseNumber(number)} to SUBMISSION: ${labels(unverified)} not verified yet.`,
      );
    }
  }
}

export async function listCases(ctx: Context, raw: z.input<typeof listCasesInput>) {
  requireLevel(ctx, "cases", "view");
  const input = listCasesInput.parse(raw);
  const where: Prisma.CaseWhereInput = {
    ...(input.stage
      ? { stage: input.stage }
      : input.includeClosed
        ? {}
        : { stage: { in: [...OPEN_STAGES] } }),
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.dueBefore ? { dueDate: { lte: parseDateOnly(input.dueBefore) } } : {}),
  };
  const rows = await ctx.db.case.findMany({
    where,
    include: caseInclude,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    ...pageArgs(input),
  });
  return toPage(rows, input.limit, caseSummaryDto);
}

export async function getCase(ctx: Context, raw: z.input<typeof getCaseInput>) {
  requireLevel(ctx, "cases", "view");
  return caseDetailDto(await loadCase(ctx.db, getCaseInput.parse(raw).case));
}

export async function createCase(ctx: Context, raw: z.input<typeof createCaseInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = createCaseInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
    if (!client) throw notFound("client", input.clientId);
    const template = await tx.template.findUnique({
      where: templateWhere(input.template),
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          include: { items: { orderBy: { position: "asc" } } },
        },
      },
    });
    if (!template) throw notFound("template", input.template);
    if (template.archivedAt)
      throw new DomainError("CONFLICT", `Template ${template.slug} is archived.`);
    const version = template.versions[0];
    if (!version) {
      throw new DomainError("CONFLICT", `Template ${template.slug} has no published version yet.`);
    }
    await assertAssignee(tx, input.assigneeId);

    const created = await tx.case.create({
      data: {
        clientId: client.id,
        templateVersionId: version.id,
        assigneeId: input.assigneeId,
        dueDate: input.dueDate ? parseDateOnly(input.dueDate) : null,
        notes: input.notes,
        items: {
          create: version.items.map((item, index) => ({
            templateItemId: item.id,
            position: index + 1,
            label: item.label,
            kind: item.kind,
            required: item.required,
          })),
        },
      },
    });
    const row = await loadCase(tx, created.id);
    await audit(tx, ctx, {
      action: "case.created",
      entity: "Case",
      entityId: created.id,
      after: caseSummaryDto(row),
    });
    return caseDetailDto(row);
  });
}

export async function updateCase(ctx: Context, raw: z.input<typeof updateCaseInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = updateCaseInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await loadCase(tx, input.case);
    assertOpen(before);
    await assertAssignee(tx, input.assigneeId);
    await tx.case.update({
      where: { id: before.id },
      data: {
        assigneeId: input.assigneeId,
        dueDate:
          input.dueDate === undefined
            ? undefined
            : input.dueDate
              ? parseDateOnly(input.dueDate)
              : null,
        notes: input.notes,
      },
    });
    const row = await loadCase(tx, before.id);
    await audit(tx, ctx, {
      action: "case.updated",
      entity: "Case",
      entityId: row.id,
      before: caseSummaryDto(before),
      after: caseSummaryDto(row),
    });
    return caseDetailDto(row);
  });
}

export async function moveCaseStage(ctx: Context, raw: z.input<typeof moveCaseStageInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = moveCaseStageInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const row = await loadCase(tx, input.case);
    assertOpen(row);
    if (row.stage === input.stage) return caseDetailDto(row);
    checkStageGuards(ctx, input.stage, row.items, row.number);
    await tx.case.update({ where: { id: row.id }, data: { stage: input.stage } });
    await audit(tx, ctx, {
      action: "case.stage_changed",
      entity: "Case",
      entityId: row.id,
      before: { stage: row.stage },
      after: { stage: input.stage, note: input.note },
    });
    return caseDetailDto(await loadCase(tx, row.id));
  });
}

export async function updateCaseItem(ctx: Context, raw: z.input<typeof updateCaseItemInput>) {
  requireLevel(ctx, "cases", "edit");
  const input = updateCaseItemInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const row = await loadCase(tx, input.case);
    assertOpen(row);
    const item = row.items.find((i) => i.id === input.itemId);
    if (!item) throw notFound(`checklist item on ${caseNumber(row.number)}`, input.itemId);

    const status = input.status ?? item.status;
    if (input.status === "VERIFIED") requireHuman(ctx, "mark an item VERIFIED");
    if (input.status === "WAIVED") requireHuman(ctx, "waive an item");
    const note = input.note === undefined ? item.note : input.note;
    if ((status === "FLAGGED" || status === "WAIVED") && input.status && !input.note) {
      throw new DomainError("VALIDATION", `A ${status} item needs a note saying why.`);
    }

    if (input.documentIds?.length) {
      const docs = await tx.document.findMany({
        where: { id: { in: input.documentIds }, clientId: row.clientId, deletedAt: null },
      });
      if (docs.length !== new Set(input.documentIds).size) {
        throw new DomainError(
          "NOT_FOUND",
          "Some documents do not exist or belong to another client.",
        );
      }
      await tx.document.updateMany({
        where: { id: { in: input.documentIds } },
        data: { caseId: row.id, caseItemId: item.id },
      });
    }

    const updated = await tx.caseItem.update({
      where: { id: item.id },
      data: {
        status,
        note,
        flaggedByKind:
          status === "FLAGGED" ? (input.status ? ctx.actor.kind : item.flaggedByKind) : null,
        updatedById: ctx.actor.employeeId,
      },
      include: { documents: { where: { deletedAt: null }, select: { id: true } } },
    });
    await audit(tx, ctx, {
      action: "case_item.updated",
      entity: "CaseItem",
      entityId: item.id,
      before: caseItemDto(item),
      after: caseItemDto(updated),
    });
    return caseDetailDto(await loadCase(tx, row.id));
  });
}

export async function closeCase(ctx: Context, raw: z.input<typeof closeCaseInput>) {
  const input = closeCaseInput.parse(raw);
  if ((input.outcome === "MORE_DOCUMENTS" || input.outcome === "WITHDRAWN") && !input.note) {
    throw new DomainError("VALIDATION", `${input.outcome} needs a note.`);
  }
  if (input.outcome === "WITHDRAWN") {
    requireLevel(ctx, "cases", "edit");
  } else if (!ctx.actor.permissions.markSubmitted) {
    throw new DomainError("FORBIDDEN", `The ${ctx.actor.roleName} role cannot record outcomes.`);
  }

  return ctx.db.$transaction(async (tx) => {
    const row = await loadCase(tx, input.case);
    assertOpen(row);
    if (input.outcome !== "WITHDRAWN" && row.stage !== "SUBMISSION") {
      throw new DomainError(
        "GUARD_FAILED",
        `${caseNumber(row.number)} is in ${row.stage}. Outcomes are recorded once a case is in SUBMISSION.`,
      );
    }

    const now = ctx.now();
    const data: Prisma.CaseUpdateInput =
      input.outcome === "MORE_DOCUMENTS"
        ? { stage: "COLLECTING" }
        : input.outcome === "WITHDRAWN"
          ? { stage: "CANCELLED", outcome: "WITHDRAWN", closedAt: now }
          : { stage: "DONE", outcome: input.outcome, closedAt: now };
    await tx.case.update({ where: { id: row.id }, data });
    await audit(tx, ctx, {
      action: input.outcome === "MORE_DOCUMENTS" ? "case.more_documents" : "case.closed",
      entity: "Case",
      entityId: row.id,
      before: { stage: row.stage },
      after: { ...data, note: input.note },
    });
    return caseDetailDto(await loadCase(tx, row.id));
  });
}
