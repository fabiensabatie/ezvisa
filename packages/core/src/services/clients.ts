import type { Prisma } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireLevel } from "../context.js";
import {
  addDays,
  bangkokToday,
  dateOnly,
  daysBetween,
  formatDateOnly,
  parseDateOnly,
} from "../dates.js";
import { caseSummaryDto, clientDto, documentDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { pageArgs, pageInput, toPage } from "../pagination.js";
import { id, notFound } from "../refs.js";

const channel = z.enum(["LINE", "WHATSAPP", "MESSENGER", "EMAIL", "PHONE"]);

const fields = {
  fullName: z.string().trim().min(1).max(200).describe("Full name exactly as on the passport"),
  nationality: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code")
    .describe("ISO 3166-1 alpha-2 country code, e.g. GB, DE, US"),
  passportNo: z.string().trim().max(30).describe("Passport number"),
  dateOfBirth: dateOnly.describe("Date of birth, YYYY-MM-DD"),
  email: z.string().trim().email().describe("Email address"),
  phone: z.string().trim().max(40).describe("Phone number with country code"),
  channel: channel.describe("Preferred contact channel"),
  channelHandle: z.string().trim().max(120).describe("LINE id, WhatsApp number or similar"),
  address: z.string().trim().max(500).describe("Address in Thailand"),
  visaType: z.string().trim().max(120).describe('Current visa, e.g. "Non-O retirement" or "DTV"'),
  stayUntil: dateOnly.describe("Date the permission to stay ends, YYYY-MM-DD"),
  nextReportDue: dateOnly.describe("Date the next 90-day report is due, YYYY-MM-DD"),
  notes: z.string().max(5000).describe("Free notes"),
};

export const createClientInput = z.object({
  fullName: fields.fullName,
  nationality: fields.nationality,
  passportNo: fields.passportNo.optional(),
  dateOfBirth: fields.dateOfBirth.optional(),
  email: fields.email.optional(),
  phone: fields.phone.optional(),
  channel: fields.channel.optional(),
  channelHandle: fields.channelHandle.optional(),
  address: fields.address.optional(),
  visaType: fields.visaType.optional(),
  stayUntil: fields.stayUntil.optional(),
  nextReportDue: fields.nextReportDue.optional(),
  notes: fields.notes.optional(),
  consentGiven: z
    .boolean()
    .optional()
    .describe("True once the client accepted the privacy notice (PDPA). Required before uploads."),
});

export const updateClientInput = z.object({
  clientId: id("Client"),
  fullName: fields.fullName.optional(),
  nationality: fields.nationality.optional(),
  passportNo: fields.passportNo.nullable().optional(),
  dateOfBirth: fields.dateOfBirth.nullable().optional(),
  email: fields.email.nullable().optional(),
  phone: fields.phone.nullable().optional(),
  channel: fields.channel.optional(),
  channelHandle: fields.channelHandle.nullable().optional(),
  address: fields.address.nullable().optional(),
  visaType: fields.visaType.nullable().optional(),
  stayUntil: fields.stayUntil.nullable().optional(),
  nextReportDue: fields.nextReportDue.nullable().optional(),
  notes: fields.notes.nullable().optional(),
  consentGiven: z
    .boolean()
    .optional()
    .describe("True records PDPA consent now; false records that consent was withdrawn"),
});

export const listClientsInput = z.object({
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Matches name, email, phone or passport number"),
  expiringWithinDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional()
    .describe("Only clients whose stay ends or 90-day report is due within this many days"),
  ...pageInput,
});

export const getClientInput = z.object({ clientId: id("Client") });
export const deleteClientInput = z.object({ clientId: id("Client") });

const dateOrNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : parseDateOnly(value);

async function findClient(ctx: Context, clientId: string) {
  const client = await ctx.db.client.findFirst({ where: { id: clientId, deletedAt: null } });
  if (!client) throw notFound("client", clientId);
  return client;
}

export async function listClients(ctx: Context, raw: z.input<typeof listClientsInput>) {
  requireLevel(ctx, "clients", "view");
  const input = listClientsInput.parse(raw);
  const and: Prisma.ClientWhereInput[] = [{ deletedAt: null }];

  if (input.search) {
    const contains = { contains: input.search, mode: "insensitive" as const };
    and.push({
      OR: [
        { fullName: contains },
        { email: contains },
        { phone: contains },
        { passportNo: contains },
      ],
    });
  }
  if (input.expiringWithinDays !== undefined) {
    const today = bangkokToday(ctx.now());
    const range = {
      gte: parseDateOnly(today),
      lte: parseDateOnly(addDays(today, input.expiringWithinDays)),
    };
    and.push({ OR: [{ stayUntil: range }, { nextReportDue: range }] });
  }

  const rows = await ctx.db.client.findMany({
    where: { AND: and },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    ...pageArgs(input),
  });
  return toPage(rows, input.limit, clientDto);
}

export async function getClient(ctx: Context, raw: z.input<typeof getClientInput>) {
  requireLevel(ctx, "clients", "view");
  const { clientId } = getClientInput.parse(raw);
  const client = await ctx.db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    include: {
      cases: {
        include: {
          client: true,
          assignee: true,
          templateVersion: { include: { template: true } },
          items: true,
        },
        orderBy: { createdAt: "desc" },
      },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) throw notFound("client", clientId);

  const today = bangkokToday(ctx.now());
  const deadlines = [
    { kind: "STAY_ENDS", date: client.stayUntil },
    { kind: "REPORT_DUE", date: client.nextReportDue },
  ]
    .filter((d): d is { kind: string; date: Date } => d.date !== null)
    .map((d) => ({
      kind: d.kind,
      date: formatDateOnly(d.date),
      daysLeft: daysBetween(today, formatDateOnly(d.date)),
    }));

  return {
    ...clientDto(client),
    deadlines,
    cases: client.cases.map(caseSummaryDto),
    documents: client.documents.map(documentDto),
  };
}

export async function createClient(ctx: Context, raw: z.input<typeof createClientInput>) {
  requireLevel(ctx, "clients", "edit");
  const { consentGiven, ...input } = createClientInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        ...input,
        nationality: input.nationality.toUpperCase(),
        email: input.email?.toLowerCase(),
        dateOfBirth: dateOrNull(input.dateOfBirth),
        stayUntil: dateOrNull(input.stayUntil),
        nextReportDue: dateOrNull(input.nextReportDue),
        consentAt: consentGiven ? ctx.now() : null,
      },
    });
    await audit(tx, ctx, {
      action: "client.created",
      entity: "Client",
      entityId: client.id,
      after: clientDto(client),
    });
    return clientDto(client);
  });
}

export async function updateClient(ctx: Context, raw: z.input<typeof updateClientInput>) {
  requireLevel(ctx, "clients", "edit");
  const { clientId, consentGiven, ...input } = updateClientInput.parse(raw);
  const before = await findClient(ctx, clientId);

  return ctx.db.$transaction(async (tx) => {
    const client = await tx.client.update({
      where: { id: clientId },
      data: {
        ...input,
        nationality: input.nationality?.toUpperCase(),
        email: input.email === null ? null : input.email?.toLowerCase(),
        dateOfBirth: dateOrNull(input.dateOfBirth),
        stayUntil: dateOrNull(input.stayUntil),
        nextReportDue: dateOrNull(input.nextReportDue),
        consentAt:
          consentGiven === undefined
            ? undefined
            : consentGiven
              ? (before.consentAt ?? ctx.now())
              : null,
      },
    });
    await audit(tx, ctx, {
      action: "client.updated",
      entity: "Client",
      entityId: client.id,
      before: clientDto(before),
      after: clientDto(client),
    });
    return clientDto(client);
  });
}

export async function deleteClient(ctx: Context, raw: z.input<typeof deleteClientInput>) {
  requireLevel(ctx, "clients", "full");
  const { clientId } = deleteClientInput.parse(raw);
  const client = await findClient(ctx, clientId);
  const openCases = await ctx.db.case.count({
    where: { clientId, stage: { notIn: ["DONE", "CANCELLED"] } },
  });
  if (openCases > 0) {
    throw new DomainError(
      "CONFLICT",
      `${client.fullName} has ${openCases} open case(s). Close or cancel them first.`,
    );
  }
  return ctx.db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { deletedAt: ctx.now() } });
    await audit(tx, ctx, {
      action: "client.deleted",
      entity: "Client",
      entityId: clientId,
      before: clientDto(client),
    });
    return { deleted: true as const, clientId };
  });
}
