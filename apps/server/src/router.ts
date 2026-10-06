import {
  cases,
  clients,
  dashboard,
  documents,
  reminders,
  settings,
  team,
  templates,
} from "@ezvisa/core";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./trpc.js";

/**
 * The dashboard API. Every procedure is a thin wrapper over a core service, which checks
 * permissions and writes the audit log. The web app imports only the AppRouter type,
 * so nothing here is bundled into the browser.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    service: "ezvisa",
    time: new Date().toISOString(),
  })),

  me: protectedProcedure.query(async ({ ctx }) => ({
    ...(await team.whoami(ctx.domain)),
    settings: await settings.getPublicSettings(ctx.domain),
  })),
  navCounts: protectedProcedure.query(({ ctx }) => dashboard.navCounts(ctx.domain)),
  overview: protectedProcedure.query(({ ctx }) => dashboard.overview(ctx.domain)),

  cases: router({
    list: protectedProcedure
      .input(cases.listCasesInput)
      .query(({ ctx, input }) => cases.listCases(ctx.domain, input)),
    get: protectedProcedure
      .input(cases.getCaseInput)
      .query(({ ctx, input }) => cases.getCase(ctx.domain, input)),
    create: protectedProcedure
      .input(cases.createCaseInput)
      .mutation(({ ctx, input }) => cases.createCase(ctx.domain, input)),
    update: protectedProcedure
      .input(cases.updateCaseInput)
      .mutation(({ ctx, input }) => cases.updateCase(ctx.domain, input)),
    moveStage: protectedProcedure
      .input(cases.moveCaseStageInput)
      .mutation(({ ctx, input }) => cases.moveCaseStage(ctx.domain, input)),
    updateItem: protectedProcedure
      .input(cases.updateCaseItemInput)
      .mutation(({ ctx, input }) => cases.updateCaseItem(ctx.domain, input)),
    close: protectedProcedure
      .input(cases.closeCaseInput)
      .mutation(({ ctx, input }) => cases.closeCase(ctx.domain, input)),
  }),

  clients: router({
    list: protectedProcedure
      .input(clients.listClientsInput)
      .query(({ ctx, input }) => clients.listClients(ctx.domain, input)),
    get: protectedProcedure
      .input(clients.getClientInput)
      .query(({ ctx, input }) => clients.getClient(ctx.domain, input)),
    create: protectedProcedure
      .input(clients.createClientInput)
      .mutation(({ ctx, input }) => clients.createClient(ctx.domain, input)),
    update: protectedProcedure
      .input(clients.updateClientInput)
      .mutation(({ ctx, input }) => clients.updateClient(ctx.domain, input)),
  }),

  documents: router({
    /** A 5-minute download link. A mutation because each link issued is audited. */
    link: protectedProcedure
      .input(documents.getDocumentInput)
      .mutation(({ ctx, input }) => documents.getDocument(ctx.domain, input)),
    /** A 10-minute presigned PUT link; the browser uploads straight to the bucket. */
    createUpload: protectedProcedure
      .input(documents.createDocumentUploadInput)
      .mutation(({ ctx, input }) => documents.createDocumentUpload(ctx.domain, input)),
    confirmUpload: protectedProcedure
      .input(documents.confirmDocumentUploadInput)
      .mutation(({ ctx, input }) => documents.confirmDocumentUpload(ctx.domain, input)),
    delete: protectedProcedure
      .input(documents.deleteDocumentInput)
      .mutation(({ ctx, input }) => documents.deleteDocument(ctx.domain, input)),
  }),

  reminders: router({
    list: protectedProcedure
      .input(reminders.listRemindersInput)
      .query(({ ctx, input }) => reminders.listReminders(ctx.domain, input)),
    deadlines: protectedProcedure
      .input(reminders.listDeadlinesInput)
      .query(({ ctx, input }) => reminders.listDeadlines(ctx.domain, input)),
    rules: protectedProcedure.query(({ ctx }) => reminders.getReminderRules(ctx.domain)),
    markSent: protectedProcedure
      .input(reminders.markReminderSentInput)
      .mutation(({ ctx, input }) => reminders.markReminderSent(ctx.domain, input)),
    skip: protectedProcedure
      .input(reminders.skipReminderInput)
      .mutation(({ ctx, input }) => reminders.skipReminder(ctx.domain, input)),
    updateRule: protectedProcedure
      .input(reminders.updateReminderRuleInput)
      .mutation(({ ctx, input }) => reminders.updateReminderRule(ctx.domain, input)),
  }),

  settings: router({
    update: protectedProcedure
      .input(settings.updateSettingsInput)
      .mutation(({ ctx, input }) => settings.updateSettings(ctx.domain, input)),
  }),

  team: router({
    employees: protectedProcedure
      .input(team.listEmployeesInput)
      .query(({ ctx, input }) => team.listEmployees(ctx.domain, input)),
    roles: protectedProcedure.query(({ ctx }) => team.listRoles(ctx.domain)),
    assignees: protectedProcedure.query(({ ctx }) => team.listAssignees(ctx.domain)),
    tokens: protectedProcedure
      .input(z.object({}).optional())
      .query(({ ctx }) => team.listTokens(ctx.domain, {})),
    createEmployee: protectedProcedure
      .input(team.createEmployeeInput)
      .mutation(({ ctx, input }) => team.createEmployee(ctx.domain, input)),
    updateEmployee: protectedProcedure
      .input(team.updateEmployeeInput)
      .mutation(({ ctx, input }) => team.updateEmployee(ctx.domain, input)),
    deactivateEmployee: protectedProcedure
      .input(team.deactivateEmployeeInput)
      .mutation(({ ctx, input }) => team.deactivateEmployee(ctx.domain, input)),
    /** Returns the plain token once, in `secret`. */
    createToken: protectedProcedure
      .input(team.createTokenInput)
      .mutation(({ ctx, input }) => team.createToken(ctx.domain, input)),
    revokeToken: protectedProcedure
      .input(team.revokeTokenInput)
      .mutation(({ ctx, input }) => team.revokeToken(ctx.domain, input)),
  }),

  templates: router({
    list: protectedProcedure
      .input(templates.listTemplatesInput)
      .query(({ ctx, input }) => templates.listTemplates(ctx.domain, input)),
    get: protectedProcedure
      .input(templates.getTemplateInput)
      .query(({ ctx, input }) => templates.getTemplate(ctx.domain, input)),
    create: protectedProcedure
      .input(templates.createTemplateInput)
      .mutation(({ ctx, input }) => templates.createTemplate(ctx.domain, input)),
    update: protectedProcedure
      .input(templates.updateTemplateInput)
      .mutation(({ ctx, input }) => templates.updateTemplate(ctx.domain, input)),
    addItem: protectedProcedure
      .input(templates.addTemplateItemInput)
      .mutation(({ ctx, input }) => templates.addTemplateItem(ctx.domain, input)),
    updateItem: protectedProcedure
      .input(templates.updateTemplateItemInput)
      .mutation(({ ctx, input }) => templates.updateTemplateItem(ctx.domain, input)),
    removeItem: protectedProcedure
      .input(templates.removeTemplateItemInput)
      .mutation(({ ctx, input }) => templates.removeTemplateItem(ctx.domain, input)),
    reorderItems: protectedProcedure
      .input(templates.reorderTemplateItemsInput)
      .mutation(({ ctx, input }) => templates.reorderTemplateItems(ctx.domain, input)),
    createFileUpload: protectedProcedure
      .input(templates.createTemplateFileUploadInput)
      .mutation(({ ctx, input }) => templates.createTemplateFileUpload(ctx.domain, input)),
    confirmFileUpload: protectedProcedure
      .input(templates.confirmTemplateFileUploadInput)
      .mutation(({ ctx, input }) => templates.confirmTemplateFileUpload(ctx.domain, input)),
    removeFile: protectedProcedure
      .input(templates.removeTemplateFileInput)
      .mutation(({ ctx, input }) => templates.removeTemplateFile(ctx.domain, input)),
    publish: protectedProcedure
      .input(templates.publishTemplateVersionInput)
      .mutation(({ ctx, input }) => templates.publishTemplateVersion(ctx.domain, input)),
    discardDraft: protectedProcedure
      .input(templates.discardTemplateDraftInput)
      .mutation(({ ctx, input }) => templates.discardTemplateDraft(ctx.domain, input)),
    archive: protectedProcedure
      .input(templates.archiveTemplateInput)
      .mutation(({ ctx, input }) => templates.archiveTemplate(ctx.domain, input)),
  }),
});

export type AppRouter = typeof appRouter;
