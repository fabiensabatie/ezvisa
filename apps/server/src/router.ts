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
 * The dashboard API, read side (M2). The web app imports only the AppRouter type,
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
  }),

  clients: router({
    list: protectedProcedure
      .input(clients.listClientsInput)
      .query(({ ctx, input }) => clients.listClients(ctx.domain, input)),
    get: protectedProcedure
      .input(clients.getClientInput)
      .query(({ ctx, input }) => clients.getClient(ctx.domain, input)),
  }),

  documents: router({
    /** A 5-minute download link. A mutation because each link issued is audited. */
    link: protectedProcedure
      .input(documents.getDocumentInput)
      .mutation(({ ctx, input }) => documents.getDocument(ctx.domain, input)),
  }),

  reminders: router({
    list: protectedProcedure
      .input(reminders.listRemindersInput)
      .query(({ ctx, input }) => reminders.listReminders(ctx.domain, input)),
    deadlines: protectedProcedure
      .input(reminders.listDeadlinesInput)
      .query(({ ctx, input }) => reminders.listDeadlines(ctx.domain, input)),
    rules: protectedProcedure.query(({ ctx }) => reminders.getReminderRules(ctx.domain)),
  }),

  team: router({
    employees: protectedProcedure
      .input(team.listEmployeesInput)
      .query(({ ctx, input }) => team.listEmployees(ctx.domain, input)),
    roles: protectedProcedure.query(({ ctx }) => team.listRoles(ctx.domain)),
    tokens: protectedProcedure
      .input(z.object({}).optional())
      .query(({ ctx }) => team.listTokens(ctx.domain, {})),
  }),

  templates: router({
    list: protectedProcedure
      .input(templates.listTemplatesInput)
      .query(({ ctx, input }) => templates.listTemplates(ctx.domain, input)),
    get: protectedProcedure
      .input(templates.getTemplateInput)
      .query(({ ctx, input }) => templates.getTemplate(ctx.domain, input)),
  }),
});

export type AppRouter = typeof appRouter;
