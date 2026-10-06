import type { Client, Prisma, Reminder, ReminderRule } from "@ezvisa/db";
import { z } from "zod";
import { audit } from "../audit.js";
import { type Context, requireLevel, type Tx } from "../context.js";
import {
  addDays,
  bangkokToday,
  daysBetween,
  formatDateOnly,
  formatShortDate,
  parseDateOnly,
} from "../dates.js";
import { reminderDto, reminderRuleDto } from "../dto.js";
import { DomainError } from "../errors.js";
import { caseNumber, id, notFound } from "../refs.js";

const deadlineKind = z.enum(["STAY_ENDS", "REPORT_DUE"]);
const FIELD = { STAY_ENDS: "stayUntil", REPORT_DUE: "nextReportDue" } as const;

export const listDeadlinesInput = z.object({
  withinDays: z.number().int().min(0).max(365).default(60),
});
export const listRemindersInput = z.object({
  status: z.enum(["SCHEDULED", "DUE", "SENT", "SKIPPED", "CANCELLED"]).optional(),
  withinDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .default(30)
    .describe("Reminders due to go out within this many days"),
});
export const markReminderSentInput = z.object({
  reminderId: id("Reminder"),
  message: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe("The text actually sent, if edited"),
});
export const skipReminderInput = z.object({
  reminderId: id("Reminder"),
  note: z.string().trim().max(500).optional(),
});
export const updateReminderRuleInput = z.object({
  kind: deadlineKind,
  offsetsDays: z
    .array(z.number().int().min(0).max(180))
    .min(1)
    .optional()
    .describe("Days before the deadline, e.g. [60, 30, 14, 7]"),
  messageTemplate: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .describe("Variables: {first_name}, {deadline}, {days_left}, {agent_name}"),
  active: z.boolean().optional(),
});

export function renderReminder(
  template: string,
  values: { firstName: string; deadline: string; daysLeft: number; agentName: string },
): string {
  return template
    .replaceAll("{first_name}", values.firstName)
    .replaceAll("{deadline}", formatShortDate(values.deadline))
    .replaceAll("{days_left}", String(values.daysLeft))
    .replaceAll("{agent_name}", values.agentName);
}

async function agentName(tx: Tx): Promise<string> {
  const setting = await tx.setting.findUnique({ where: { key: "agent.name" } });
  return typeof setting?.value === "string" ? setting.value : "EzVisa";
}

function deadlineOf(client: Client, kind: keyof typeof FIELD): Date | null {
  return client[FIELD[kind]];
}

/**
 * Brings reminder rows in line with client deadlines, idempotently:
 * schedules one row per future offset, adds one catch-up row when a deadline has none yet,
 * cancels rows whose deadline changed, and marks rows whose send date arrived as DUE.
 */
export async function syncReminders(tx: Tx, today: string): Promise<void> {
  const rules = await tx.reminderRule.findMany({ where: { active: true } });
  for (const rule of rules) {
    const horizon = Math.max(...rule.offsetsDays, 0);
    const range = { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, horizon)) };
    const clients = await tx.client.findMany({
      where: {
        deletedAt: null,
        ...(rule.kind === "STAY_ENDS" ? { stayUntil: range } : { nextReportDue: range }),
      },
      include: { reminders: { where: { kind: rule.kind } } },
    });

    for (const client of clients) {
      const deadlineDate = deadlineOf(client, rule.kind);
      if (!deadlineDate) continue;
      const deadline = formatDateOnly(deadlineDate);
      const existing = client.reminders.filter((r) => formatDateOnly(r.deadline) === deadline);
      const offsets = [...rule.offsetsDays].sort((a, b) => b - a);
      const future = offsets.filter((o) => addDays(deadline, -o) >= today);
      const missed = offsets.filter((o) => addDays(deadline, -o) < today);
      // One catch-up for a deadline we just learned about, unless a reminder goes out soon anyway.
      const nextSend = future[0] === undefined ? null : addDays(deadline, -future[0]);
      const catchUp =
        existing.length === 0 &&
        missed.length > 0 &&
        (nextSend === null || daysBetween(today, nextSend) > 3);
      const wanted = catchUp ? [...future, missed.at(-1) ?? 0] : future;

      for (const offset of wanted) {
        await tx.reminder.upsert({
          where: {
            clientId_kind_deadline_offsetDays: {
              clientId: client.id,
              kind: rule.kind,
              deadline: deadlineDate,
              offsetDays: offset,
            },
          },
          update: {},
          create: {
            clientId: client.id,
            kind: rule.kind,
            deadline: deadlineDate,
            offsetDays: offset,
            sendOn: parseDateOnly(
              addDays(deadline, -offset) < today ? today : addDays(deadline, -offset),
            ),
            channel: client.channel,
          },
        });
      }
    }
  }

  // Pending reminders whose client deadline moved or disappeared.
  const pending = await tx.reminder.findMany({
    where: { status: { in: ["SCHEDULED", "DUE"] } },
    include: { client: true },
  });
  const stale = pending.filter((r) => {
    const current = r.client.deletedAt ? null : deadlineOf(r.client, r.kind);
    return !current || formatDateOnly(current) !== formatDateOnly(r.deadline);
  });
  if (stale.length) {
    await tx.reminder.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: { status: "CANCELLED" },
    });
  }

  await tx.reminder.updateMany({
    where: { status: "SCHEDULED", sendOn: { lte: parseDateOnly(today) } },
    data: { status: "DUE" },
  });
}

export async function listDeadlines(ctx: Context, raw: z.input<typeof listDeadlinesInput>) {
  requireLevel(ctx, "reminders", "view");
  const { withinDays } = listDeadlinesInput.parse(raw);
  const today = bangkokToday(ctx.now());
  const range = { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, withinDays)) };
  const clients = await ctx.db.client.findMany({
    where: { deletedAt: null, OR: [{ stayUntil: range }, { nextReportDue: range }] },
    include: {
      cases: {
        where: { stage: { notIn: ["DONE", "CANCELLED"] } },
        include: { templateVersion: { include: { template: true } } },
      },
    },
  });

  const items = clients.flatMap((client) =>
    (["STAY_ENDS", "REPORT_DUE"] as const).flatMap((kind) => {
      const date = deadlineOf(client, kind);
      if (!date) return [];
      const deadline = formatDateOnly(date);
      const daysLeft = daysBetween(today, deadline);
      if (daysLeft < 0 || daysLeft > withinDays) return [];
      const openCase = client.cases.find((c) => c.templateVersion.template.deadlineKind === kind);
      return [
        {
          client: { id: client.id, fullName: client.fullName, channel: client.channel },
          kind,
          deadline,
          daysLeft,
          openCase: openCase
            ? { number: caseNumber(openCase.number), stage: openCase.stage }
            : null,
        },
      ];
    }),
  );
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return { today, items };
}

async function renderFor(
  tx: Tx,
  reminders: Array<Reminder & { client: Client }>,
  rules: ReminderRule[],
  today: string,
) {
  const name = await agentName(tx);
  return reminders.map((r) => {
    const rule = rules.find((x) => x.kind === r.kind);
    const deadline = formatDateOnly(r.deadline);
    // Counted from today, or from the send date for reminders still in the future.
    const from = formatDateOnly(r.sendOn) > today ? formatDateOnly(r.sendOn) : today;
    const text = rule
      ? renderReminder(rule.messageTemplate, {
          firstName: r.client.fullName.split(/\s+/)[0] ?? r.client.fullName,
          deadline,
          daysLeft: daysBetween(from, deadline),
          agentName: name,
        })
      : null;
    return reminderDto(r, text);
  });
}

export async function listReminders(ctx: Context, raw: z.input<typeof listRemindersInput>) {
  requireLevel(ctx, "reminders", "view");
  const input = listRemindersInput.parse(raw);
  const today = bangkokToday(ctx.now());
  await ctx.db.$transaction((tx) => syncReminders(tx, today));

  const where: Prisma.ReminderWhereInput = input.status
    ? { status: input.status }
    : {
        status: { in: ["DUE", "SCHEDULED"] },
        sendOn: { lte: parseDateOnly(addDays(today, input.withinDays)) },
      };
  const rows = await ctx.db.reminder.findMany({
    where,
    include: { client: true },
    orderBy: [{ sendOn: "asc" }, { id: "asc" }],
    take: 200,
  });
  const rules = await ctx.db.reminderRule.findMany();
  return { today, items: await renderFor(ctx.db, rows, rules, today) };
}

async function findPending(tx: Tx, reminderId: string) {
  const reminder = await tx.reminder.findUnique({
    where: { id: reminderId },
    include: { client: true },
  });
  if (!reminder) throw notFound("reminder", reminderId);
  if (reminder.status !== "DUE" && reminder.status !== "SCHEDULED") {
    throw new DomainError("CONFLICT", `This reminder is already ${reminder.status}.`);
  }
  return reminder;
}

export async function markReminderSent(ctx: Context, raw: z.input<typeof markReminderSentInput>) {
  requireLevel(ctx, "reminders", "edit");
  const input = markReminderSentInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const reminder = await findPending(tx, input.reminderId);
    const rules = await tx.reminderRule.findMany();
    const [rendered] = await renderFor(tx, [reminder], rules, bangkokToday(ctx.now()));
    const message = input.message ?? rendered?.message ?? null;
    const updated = await tx.reminder.update({
      where: { id: reminder.id },
      data: { status: "SENT", sentAt: ctx.now(), sentById: ctx.actor.employeeId, message },
      include: { client: true },
    });
    await audit(tx, ctx, {
      action: "reminder.sent",
      entity: "Reminder",
      entityId: reminder.id,
      after: { channel: updated.channel, message },
    });
    return reminderDto(updated, message);
  });
}

export async function skipReminder(ctx: Context, raw: z.input<typeof skipReminderInput>) {
  requireLevel(ctx, "reminders", "edit");
  const input = skipReminderInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const reminder = await findPending(tx, input.reminderId);
    const updated = await tx.reminder.update({
      where: { id: reminder.id },
      data: { status: "SKIPPED" },
      include: { client: true },
    });
    await audit(tx, ctx, {
      action: "reminder.skipped",
      entity: "Reminder",
      entityId: reminder.id,
      after: { note: input.note },
    });
    return reminderDto(updated, null);
  });
}

export async function getReminderRules(ctx: Context) {
  requireLevel(ctx, "reminders", "view");
  const rules = await ctx.db.reminderRule.findMany({ orderBy: { kind: "asc" } });
  return { items: rules.map(reminderRuleDto) };
}

export async function updateReminderRule(
  ctx: Context,
  raw: z.input<typeof updateReminderRuleInput>,
) {
  requireLevel(ctx, "reminders", "full");
  const { kind, ...input } = updateReminderRuleInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.reminderRule.findUnique({ where: { kind } });
    if (!before) throw notFound("reminder rule", kind);
    const offsetsDays = input.offsetsDays
      ? [...new Set(input.offsetsDays)].sort((a, b) => b - a)
      : undefined;
    const rule = await tx.reminderRule.update({ where: { kind }, data: { ...input, offsetsDays } });
    await audit(tx, ctx, {
      action: "reminder_rule.updated",
      entity: "ReminderRule",
      entityId: rule.id,
      before: reminderRuleDto(before),
      after: reminderRuleDto(rule),
    });
    return reminderRuleDto(rule);
  });
}
