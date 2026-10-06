import { reminders } from "@ezvisa/core";
import { z } from "zod";
import { canAdminister, canEdit, canView, defineTool } from "../tool.js";

export const reminderTools = [
  defineTool({
    name: "list_deadlines",
    title: "List upcoming deadlines",
    description:
      "Clients whose permission to stay ends or 90-day report is due soon, with days left and whether a case is already open for it.",
    input: reminders.listDeadlinesInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("reminders"),
    run: (ctx, input) => reminders.listDeadlines(ctx, input),
  }),
  defineTool({
    name: "list_reminders",
    title: "List reminders",
    description:
      "Reminders due or scheduled soon, each with the rendered message for the client's channel. In the MVP a person sends the message, then it is marked sent.",
    input: reminders.listRemindersInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("reminders"),
    run: (ctx, input) => reminders.listReminders(ctx, input),
  }),
  defineTool({
    name: "mark_reminder_sent",
    title: "Mark a reminder sent",
    description:
      "Records that a reminder went out, with the exact text if it was edited. Only call it once the message was actually sent.",
    input: reminders.markReminderSentInput,
    visibleTo: canEdit("reminders"),
    run: (ctx, input) => reminders.markReminderSent(ctx, input),
  }),
  defineTool({
    name: "skip_reminder",
    title: "Skip a reminder",
    description: "Marks a reminder as not needed, e.g. the client already replied.",
    input: reminders.skipReminderInput,
    visibleTo: canEdit("reminders"),
    run: (ctx, input) => reminders.skipReminder(ctx, input),
  }),
  defineTool({
    name: "get_reminder_rules",
    title: "Get reminder rules",
    description: "When reminders go out for each deadline kind, and the message templates.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    visibleTo: canView("reminders"),
    run: (ctx) => reminders.getReminderRules(ctx),
  }),
  defineTool({
    name: "update_reminder_rule",
    title: "Update a reminder rule",
    description:
      "Changes the days before a deadline when reminders go out, the message template, or turns a rule off.",
    input: reminders.updateReminderRuleInput,
    annotations: { idempotentHint: true },
    visibleTo: canAdminister("reminders"),
    run: (ctx, input) => reminders.updateReminderRule(ctx, input),
  }),
];
