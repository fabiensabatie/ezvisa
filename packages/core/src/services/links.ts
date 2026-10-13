import type { UsefulLink } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireHuman, requireLevel, type Tx } from "../context.js";
import { id, notFound } from "../refs.js";

/** A link not confirmed for this long is shown as needing a check. */
export const LINK_CHECK_DAYS = 90;
const DAY_MS = 86_400_000;

export const LINK_CATEGORIES = [
  "IMMIGRATION",
  "WORK_PERMITS",
  "DOCUMENTS",
  "INSURANCE_MONEY",
  "OTHER",
] as const;
export const LINK_AUDIENCES = ["TEAM", "CLIENT", "BOTH"] as const;

const webAddress = z
  .string()
  .trim()
  .max(2000)
  .url("Use a full web address such as https://www.thaievisa.go.th")
  .refine((u) => /^https?:\/\//i.test(u), "Use a web address starting with https://")
  .describe("Full web address, e.g. https://www.thaievisa.go.th");

const fields = {
  name: z.string().trim().min(1).max(120).describe("What the team calls the site"),
  url: webAddress,
  category: z.enum(LINK_CATEGORIES),
  note: z.string().trim().max(500).nullable().optional().describe("When to use it, for new staff"),
  audience: z
    .enum(LINK_AUDIENCES)
    .describe("TEAM when only we use it, CLIENT when clients apply there themselves, or BOTH"),
  needsLogin: z.boolean().describe("The site needs the agency's login"),
  pinned: z.boolean().describe("Show it at the top for the whole team"),
};

export const listLinksInput = z.object({
  search: z.string().trim().max(120).optional().describe("Part of the name, address or note"),
  category: z.enum(LINK_CATEGORIES).optional(),
});
export const createLinkInput = z.object({
  ...fields,
  audience: fields.audience.default("TEAM"),
  needsLogin: fields.needsLogin.default(false),
  pinned: fields.pinned.default(false),
});
export const updateLinkInput = z.object({
  linkId: id("Link"),
  name: fields.name.optional(),
  url: fields.url.optional(),
  category: fields.category.optional(),
  note: fields.note,
  audience: fields.audience.optional(),
  needsLogin: fields.needsLogin.optional(),
  pinned: fields.pinned.optional(),
});
export const linkRefInput = z.object({ linkId: id("Link") });

function linkDto(link: UsefulLink, names: Map<string, string>, now: Date) {
  const checkedAt = link.checkedAt;
  return {
    id: link.id,
    name: link.name,
    url: link.url,
    category: link.category,
    note: link.note,
    audience: link.audience,
    needsLogin: link.needsLogin,
    pinned: link.pinned,
    checkedAt: checkedAt ? checkedAt.toISOString() : null,
    checkedBy: link.checkedById ? (names.get(link.checkedById) ?? null) : null,
    /** Never confirmed, or not for LINK_CHECK_DAYS days. */
    needsCheck: !checkedAt || now.getTime() - checkedAt.getTime() > LINK_CHECK_DAYS * DAY_MS,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}
export type LinkDto = ReturnType<typeof linkDto>;

async function toDtos(tx: Tx, links: UsefulLink[], now: Date): Promise<LinkDto[]> {
  const ids = [...new Set(links.flatMap((l) => (l.checkedById ? [l.checkedById] : [])))];
  const people = ids.length
    ? await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  return links.map((l) => linkDto(l, names, now));
}

async function one(tx: Tx, ctx: Context, link: UsefulLink): Promise<LinkDto> {
  const [dto] = await toDtos(tx, [link], ctx.now());
  return dto as LinkDto;
}

/** Only people change the list; agents may read it. */
function requireWrite(ctx: Context, level: "edit" | "full") {
  requireLevel(ctx, "links", level);
  requireHuman(ctx, "change the useful links");
}

export async function listLinks(ctx: Context, raw: z.input<typeof listLinksInput>) {
  requireLevel(ctx, "links", "view");
  const input = listLinksInput.parse(raw);
  const search = input.search
    ? { contains: input.search, mode: "insensitive" as const }
    : undefined;
  const rows = await ctx.db.usefulLink.findMany({
    where: {
      ...(input.category ? { category: input.category } : {}),
      ...(search ? { OR: [{ name: search }, { url: search }, { note: search }] } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return { items: await toDtos(ctx.db, rows, ctx.now()) };
}

export async function createLink(ctx: Context, raw: z.input<typeof createLinkInput>) {
  requireWrite(ctx, "edit");
  const input = createLinkInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    // Whoever adds a link has just opened it, so it counts as checked.
    const link = await tx.usefulLink.create({
      data: {
        ...input,
        note: input.note ?? null,
        checkedAt: ctx.now(),
        checkedById: ctx.actor.employeeId,
        createdById: ctx.actor.employeeId,
      },
    });
    await audit(tx, ctx, {
      action: "link.created",
      entity: "UsefulLink",
      entityId: link.id,
      after: link,
    });
    return one(tx, ctx, link);
  });
}

export async function updateLink(ctx: Context, raw: z.input<typeof updateLinkInput>) {
  requireWrite(ctx, "edit");
  const { linkId, ...changes } = updateLinkInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.usefulLink.findUnique({ where: { id: linkId } });
    if (!before) throw notFound("link", linkId);
    const link = await tx.usefulLink.update({ where: { id: linkId }, data: changes });
    await audit(tx, ctx, {
      action: "link.updated",
      entity: "UsefulLink",
      entityId: link.id,
      before,
      after: link,
    });
    return one(tx, ctx, link);
  });
}

/** Records that someone opened the link today and it still works. */
export async function markLinkChecked(ctx: Context, raw: z.input<typeof linkRefInput>) {
  requireWrite(ctx, "edit");
  const { linkId } = linkRefInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.usefulLink.findUnique({ where: { id: linkId } });
    if (!before) throw notFound("link", linkId);
    const link = await tx.usefulLink.update({
      where: { id: linkId },
      data: { checkedAt: ctx.now(), checkedById: ctx.actor.employeeId },
    });
    await audit(tx, ctx, { action: "link.checked", entity: "UsefulLink", entityId: link.id });
    return one(tx, ctx, link);
  });
}

export async function deleteLink(ctx: Context, raw: z.input<typeof linkRefInput>) {
  requireWrite(ctx, "full");
  const { linkId } = linkRefInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.usefulLink.findUnique({ where: { id: linkId } });
    if (!before) throw notFound("link", linkId);
    await tx.usefulLink.delete({ where: { id: linkId } });
    await audit(tx, ctx, {
      action: "link.deleted",
      entity: "UsefulLink",
      entityId: linkId,
      before,
    });
    return { id: linkId, deleted: true as const };
  });
}
