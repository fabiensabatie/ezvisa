import {
  agents,
  cases,
  chat,
  clients,
  dashboard,
  documents,
  forms,
  links,
  notifications,
  reminders,
  settings,
  team,
  templates,
  uploadLinks,
} from "@ezvisa/core";
import { z } from "zod";
import { clientProcedure, protectedProcedure, publicProcedure, router } from "./trpc.js";

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
    /** The link a client uses to upload their documents; replaces any earlier link. */
    shareUploadLink: protectedProcedure
      .input(uploadLinks.createUploadLinkInput)
      .mutation(({ ctx, input }) => uploadLinks.createUploadLink(ctx.domain, input)),
    revokeUploadLink: protectedProcedure
      .input(uploadLinks.revokeUploadLinkInput)
      .mutation(({ ctx, input }) => uploadLinks.revokeUploadLink(ctx.domain, input)),
  }),

  /** Template forms EzVisa fills, and each case's filled copies, checked by a person. */
  forms: router({
    template: protectedProcedure
      .input(forms.templateFormInput)
      .query(({ ctx, input }) => forms.getTemplateForm(ctx.domain, input)),
    setUp: protectedProcedure
      .input(forms.analyzeTemplateFormInput)
      .mutation(({ ctx, input }) => forms.requestTemplateForm(ctx.domain, input)),
    updateTemplate: protectedProcedure
      .input(forms.updateTemplateFormInput)
      .mutation(({ ctx, input }) => forms.updateTemplateForm(ctx.domain, input)),
    list: protectedProcedure
      .input(forms.caseFormsInput)
      .query(({ ctx, input }) => forms.listCaseForms(ctx.domain, input)),
    prepare: protectedProcedure
      .input(forms.caseFormsInput)
      .mutation(({ ctx, input }) => forms.requestCaseForms(ctx.domain, input)),
    get: protectedProcedure
      .input(forms.caseFormInput)
      .query(({ ctx, input }) => forms.getCaseForm(ctx.domain, input)),
    update: protectedProcedure
      .input(forms.updateCaseFormInput)
      .mutation(({ ctx, input }) => forms.updateCaseForm(ctx.domain, input)),
    check: protectedProcedure
      .input(forms.caseFormInput)
      .mutation(({ ctx, input }) => forms.checkCaseForm(ctx.domain, input)),
  }),

  /**
   * The client's upload page. No session: the link's secret is the credential, sent in
   * the request body (never the URL) so it stays out of access logs.
   */
  upload: router({
    view: clientProcedure
      .input(uploadLinks.linkInput)
      .mutation(({ ctx, input }) => uploadLinks.viewUploadPage(ctx.client, input)),
    acceptPrivacyNotice: clientProcedure
      .input(uploadLinks.linkInput)
      .mutation(({ ctx, input }) => uploadLinks.acceptPrivacyNotice(ctx.client, input)),
    createUpload: clientProcedure
      .input(uploadLinks.clientUploadInput)
      .mutation(({ ctx, input }) => uploadLinks.createClientUpload(ctx.client, input)),
    confirmUpload: clientProcedure
      .input(uploadLinks.confirmClientUploadInput)
      .mutation(({ ctx, input }) => uploadLinks.confirmClientUpload(ctx.client, input)),
    /** The client's own files, once their date of birth matches. */
    files: clientProcedure
      .input(uploadLinks.viewFilesInput)
      .mutation(({ ctx, input }) => uploadLinks.listClientFiles(ctx.client, input)),
    fileLink: clientProcedure
      .input(uploadLinks.clientFileInput)
      .mutation(({ ctx, input }) => uploadLinks.clientFileLink(ctx.client, input)),
    removeFile: clientProcedure
      .input(uploadLinks.removeClientFileInput)
      .mutation(({ ctx, input }) => uploadLinks.removeClientFile(ctx.client, input)),
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

  /** The shared inbox (Chatwoot): conversations, settings shared by the agents, links. */
  chat: router({
    overview: protectedProcedure.query(({ ctx }) => chat.chatOverview(ctx.domain)),
    updateSettings: protectedProcedure
      .input(chat.updateChatSettingsInput)
      .mutation(({ ctx, input }) => chat.updateChatSettings(ctx.domain, input)),
    inboxes: protectedProcedure.query(({ ctx }) => chat.chatInboxes(ctx.domain)),
    markRead: protectedProcedure
      .input(chat.getConversationInput)
      .mutation(({ ctx, input }) => chat.markConversationRead(ctx.domain, input)),
    linkTeamMember: protectedProcedure
      .input(chat.linkTeamMemberInput)
      .mutation(({ ctx, input }) => chat.linkTeamMember(ctx.domain, input)),
    conversations: protectedProcedure
      .input(chat.listConversationsInput)
      .query(({ ctx, input }) => chat.listConversations(ctx.domain, input)),
    conversation: protectedProcedure
      .input(chat.getConversationInput)
      .query(({ ctx, input }) => chat.getConversation(ctx.domain, input)),
    clientChats: protectedProcedure
      .input(chat.clientChatsInput)
      .query(({ ctx, input }) => chat.clientChats(ctx.domain, input)),
    send: protectedProcedure
      .input(chat.sendChatMessageInput)
      .mutation(({ ctx, input }) => chat.sendChatMessage(ctx.domain, input)),
    link: protectedProcedure
      .input(chat.linkChatContactInput)
      .mutation(({ ctx, input }) => chat.linkChatContact(ctx.domain, input)),
    unlink: protectedProcedure
      .input(chat.unlinkChatContactInput)
      .mutation(({ ctx, input }) => chat.unlinkChatContact(ctx.domain, input)),
    hand: protectedProcedure
      .input(chat.handConversationInput)
      .mutation(({ ctx, input }) => chat.handConversation(ctx.domain, input)),
  }),

  /** AI agents answering in the shared inbox, each with its role and inboxes. */
  agents: router({
    list: protectedProcedure.query(({ ctx }) => agents.listAgents(ctx.domain)),
    create: protectedProcedure
      .input(agents.createAgentInput)
      .mutation(({ ctx, input }) => agents.createAgent(ctx.domain, input)),
    update: protectedProcedure
      .input(agents.updateAgentInput)
      .mutation(({ ctx, input }) => agents.updateAgent(ctx.domain, input)),
    setInboxes: protectedProcedure
      .input(agents.setAgentInboxesInput)
      .mutation(({ ctx, input }) => agents.setAgentInboxes(ctx.domain, input)),
    delete: protectedProcedure
      .input(agents.agentRefInput)
      .mutation(({ ctx, input }) => agents.deleteAgent(ctx.domain, input)),
  }),

  /** Websites the team uses often, shared by the whole agency. Only people change them. */
  links: router({
    list: protectedProcedure
      .input(links.listLinksInput)
      .query(({ ctx, input }) => links.listLinks(ctx.domain, input)),
    create: protectedProcedure
      .input(links.createLinkInput)
      .mutation(({ ctx, input }) => links.createLink(ctx.domain, input)),
    update: protectedProcedure
      .input(links.updateLinkInput)
      .mutation(({ ctx, input }) => links.updateLink(ctx.domain, input)),
    markChecked: protectedProcedure
      .input(links.linkRefInput)
      .mutation(({ ctx, input }) => links.markLinkChecked(ctx.domain, input)),
    delete: protectedProcedure
      .input(links.linkRefInput)
      .mutation(({ ctx, input }) => links.deleteLink(ctx.domain, input)),
  }),

  notifications: router({
    /** The public key a browser needs to subscribe. */
    config: protectedProcedure.query(({ ctx }) => notifications.pushConfig(ctx.domain)),
    status: protectedProcedure
      .input(notifications.endpointInput)
      .query(({ ctx, input }) => notifications.subscriptionStatus(ctx.domain, input)),
    subscribe: protectedProcedure
      .input(notifications.subscribeInput)
      .mutation(({ ctx, input }) => notifications.subscribe(ctx.domain, input)),
    unsubscribe: protectedProcedure
      .input(notifications.endpointInput)
      .mutation(({ ctx, input }) => notifications.unsubscribe(ctx.domain, input)),
    test: protectedProcedure.mutation(({ ctx }) => notifications.sendTest(ctx.domain)),
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
    /** A 5-minute link to open or download a form; through a case with case access only. */
    fileLink: protectedProcedure
      .input(templates.getTemplateFileInput)
      .mutation(({ ctx, input }) => templates.getTemplateFile(ctx.domain, input)),
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
