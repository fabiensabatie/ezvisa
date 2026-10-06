import type { AuditLog } from "@ezvisa/db";
import { type Context, requireLevel } from "../context.js";
import { addDays, bangkokToday, daysBetween, formatDateOnly, parseDateOnly } from "../dates.js";
import { hasLevel } from "../permissions.js";
import { caseNumber } from "../refs.js";
import { listDeadlines } from "./reminders.js";

const OPEN = ["NEW", "COLLECTING", "DRAFTING", "VALIDATION", "SUBMISSION"] as const;
const STAGES = [...OPEN, "DONE"] as const;
const QUIET_ACTIONS = ["document.read", "document.url_issued", "template.draft_created"];

/** Counts for the sidebar badges. */
export async function navCounts(ctx: Context) {
  const p = ctx.actor.permissions;
  const today = parseDateOnly(bangkokToday(ctx.now()));
  const [openCases, clients, remindersDue, templates] = await Promise.all([
    hasLevel(p, "cases", "view")
      ? ctx.db.case.count({ where: { stage: { in: [...OPEN] } } })
      : Promise.resolve(null),
    hasLevel(p, "clients", "view")
      ? ctx.db.client.count({ where: { deletedAt: null } })
      : Promise.resolve(null),
    hasLevel(p, "reminders", "view")
      ? ctx.db.reminder.count({
          where: { status: { in: ["DUE", "SCHEDULED"] }, sendOn: { lte: today } },
        })
      : Promise.resolve(null),
    hasLevel(p, "templates", "view")
      ? ctx.db.template.count({ where: { archivedAt: null } })
      : Promise.resolve(null),
  ]);
  return { openCases, clients, remindersDue, templates };
}

type Described = { id: string; at: string; actor: string; text: string; kind: string };

async function describeActivity(ctx: Context, entries: AuditLog[]): Promise<Described[]> {
  const ids = (entity: string) => entries.filter((e) => e.entity === entity).map((e) => e.entityId);
  const [employees, caseRows, items, clientRows, templateRows] = await Promise.all([
    ctx.db.employee.findMany({
      where: { id: { in: entries.map((e) => e.actorId).filter((x): x is string => !!x) } },
    }),
    ctx.db.case.findMany({ where: { id: { in: ids("Case") } }, include: { client: true } }),
    ctx.db.caseItem.findMany({
      where: { id: { in: ids("CaseItem") } },
      include: { case: { include: { client: true } } },
    }),
    ctx.db.client.findMany({ where: { id: { in: ids("Client") } } }),
    ctx.db.template.findMany({ where: { id: { in: ids("Template") } } }),
  ]);
  const name = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "System";
  const after = (e: AuditLog) => (e.after ?? {}) as Record<string, unknown>;

  return entries.map((e) => {
    const actor = name(e.actorId);
    const kase = caseRows.find((c) => c.id === e.entityId);
    const item = items.find((i) => i.id === e.entityId);
    const client = clientRows.find((c) => c.id === e.entityId);
    const template = templateRows.find((t) => t.id === e.entityId);
    const caseLabel = kase ? `${caseNumber(kase.number)} (${kase.client.fullName})` : "a case";
    let text: string;
    switch (e.action) {
      case "client.created":
        text = `added ${client?.fullName ?? String(after(e).fullName ?? "a client")}`;
        break;
      case "client.updated":
        text = `updated ${client?.fullName ?? "a client"}`;
        break;
      case "case.created":
        text = `opened ${caseLabel}`;
        break;
      case "case.stage_changed":
        text = `moved ${caseLabel} to ${String(after(e).stage ?? "").toLowerCase()}`;
        break;
      case "case.closed":
        text = `closed ${caseLabel}: ${String(after(e).outcome ?? "").toLowerCase()}`;
        break;
      case "case.more_documents":
        text = `sent ${caseLabel} back for more documents`;
        break;
      case "case_item.updated": {
        const status = String(after(e).status ?? "").toLowerCase();
        const where = item
          ? ` on ${caseNumber(item.case.number)} (${item.case.client.fullName})`
          : "";
        text = `marked “${item?.label ?? "an item"}” ${status}${where}`;
        break;
      }
      case "document.uploaded":
        text = `uploaded ${String(after(e).filename ?? "a document")}`;
        break;
      case "document.extracted":
        text = "recorded fields read from a document";
        break;
      case "template.created":
        text = `created the ${template?.name ?? "a"} template`;
        break;
      case "template.published":
        text = `published ${template?.name ?? "a template"} v${String(after(e).version ?? "")}`;
        break;
      case "reminder.sent":
        text = `sent a reminder on ${String(after(e).channel ?? "").toLowerCase()}`;
        break;
      default:
        text = e.action.replace(/[._]/g, " ");
    }
    return { id: e.id.toString(), at: e.at.toISOString(), actor, text, kind: e.entity };
  });
}

/** Everything the overview screen shows, in one call. */
export async function overview(ctx: Context) {
  requireLevel(ctx, "cases", "view");
  const today = bangkokToday(ctx.now());
  const monthAgo = parseDateOnly(addDays(today, -30));

  const [open, recentlyDone, activityRows] = await Promise.all([
    ctx.db.case.findMany({
      where: { stage: { in: [...OPEN] } },
      include: { client: true, templateVersion: { include: { template: true } }, items: true },
    }),
    ctx.db.case.count({ where: { stage: "DONE", closedAt: { gte: monthAgo } } }),
    ctx.db.auditLog.findMany({
      where: { action: { notIn: QUIET_ACTIONS } },
      orderBy: { id: "desc" },
      take: 8,
    }),
  ]);

  const flaggedItems = open.flatMap((c) => c.items.filter((i) => i.status === "FLAGGED"));
  const pipeline = STAGES.map((stage) => ({
    stage,
    count: stage === "DONE" ? recentlyDone : open.filter((c) => c.stage === stage).length,
  }));

  const attention = open
    .map((c) => {
      const flags = c.items.filter((i) => i.status === "FLAGGED");
      const due = c.dueDate ? formatDateOnly(c.dueDate) : null;
      const daysLeft = due ? daysBetween(today, due) : null;
      const dueSoon = daysLeft !== null && daysLeft <= 3;
      if (!flags.length && !dueSoon) return null;
      return {
        number: caseNumber(c.number),
        stage: c.stage,
        client: { id: c.client.id, fullName: c.client.fullName },
        template: c.templateVersion.template.name,
        reason: flags.length
          ? (flags[0]?.note ?? `“${flags[0]?.label}” flagged`)
          : `Due at immigration ${daysLeft === 0 ? "today" : `in ${daysLeft} day(s)`}`,
        flagCount: flags.length,
        dueDate: due,
        daysLeft,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const deadlines = hasLevel(ctx.actor.permissions, "reminders", "view")
    ? (await listDeadlines(ctx, { withinDays: 35 })).items.slice(0, 6)
    : [];

  return {
    today,
    stats: {
      openCases: open.length,
      caseTypes: new Set(open.map((c) => c.templateVersion.templateId)).size,
      waitingOnClients: open.filter((c) => c.stage === "NEW" || c.stage === "COLLECTING").length,
      readyForImmigration: open.filter((c) => c.stage === "SUBMISSION").length,
      flaggedItems: flaggedItems.length,
    },
    pipeline,
    attention,
    deadlines,
    activity: await describeActivity(ctx, activityRows),
  };
}
