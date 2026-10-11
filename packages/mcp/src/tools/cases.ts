import { cases, type Permissions, uploadLinks } from "@ezvisa/core";
import { canEdit, canView, defineTool } from "../tool.js";

export const caseTools = [
  defineTool({
    name: "list_cases",
    title: "List cases",
    description:
      "Lists open cases by due date, with progress counts. Filter by stage, assignee, client or due date; closed cases on request. Paginated.",
    input: cases.listCasesInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("cases"),
    run: (ctx, input) => cases.listCases(ctx, input),
  }),
  defineTool({
    name: "get_case",
    title: "Get a case",
    description:
      "A case in full: stage, every checklist item with its status, note, documents, whether the client uploads it (clientUpload) and the form behind it (formFileId), the forms of its template version, the template's known failures, stored documents, and the client upload link in force (uploadLink: expiry and upload count). Open a form with get_template_file or read_template_file, passing this case.",
    input: cases.getCaseInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("cases"),
    run: (ctx, input) => cases.getCase(ctx, input),
  }),
  defineTool({
    name: "create_case",
    title: "Open a case",
    description:
      "Opens a case for a client from a template's published version. The checklist is copied, every item starting as MISSING.",
    input: cases.createCaseInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => cases.createCase(ctx, input),
  }),
  defineTool({
    name: "update_case",
    title: "Update a case",
    description: "Changes the assignee, due date or notes of an open case. Pass null to clear.",
    input: cases.updateCaseInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("cases"),
    run: (ctx, input) => cases.updateCase(ctx, input),
  }),
  defineTool({
    name: "move_case_stage",
    title: "Move a case to another stage",
    description:
      "Moves an open case between NEW, COLLECTING, DRAFTING, VALIDATION and SUBMISSION. VALIDATION needs every required item RECEIVED, VERIFIED or WAIVED. SUBMISSION needs a person with approval rights, no FLAGGED item and every required item VERIFIED or WAIVED, so an assistant cannot do it.",
    input: cases.moveCaseStageInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => cases.moveCaseStage(ctx, input),
  }),
  defineTool({
    name: "update_case_item",
    title: "Update a checklist item on a case",
    description:
      "Sets a checklist item's status, note and documents. Assistants may set RECEIVED or FLAGGED; FLAGGED needs a note a validator can act on, e.g. 'bank letter older than 7 days'. Only a person can set VERIFIED or WAIVED.",
    input: cases.updateCaseItemInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => cases.updateCaseItem(ctx, input),
  }),
  defineTool({
    name: "close_case",
    title: "Record an outcome",
    description:
      "Records the immigration outcome of a case in SUBMISSION: APPROVED or REJECTED closes it, MORE_DOCUMENTS sends it back to COLLECTING. WITHDRAWN cancels a case at any stage. After an approval, update the client's stayUntil or nextReportDue.",
    input: cases.closeCaseInput,
    annotations: { destructiveHint: true },
    visibleTo: (p: Permissions) => canEdit("cases")(p) || p.markSubmitted,
    run: (ctx, input) => cases.closeCase(ctx, input),
  }),
  defineTool({
    name: "create_client_upload_link",
    title: "Share the checklist with the client",
    description:
      "Creates the private link a client opens, without an account, to upload the documents the case still needs: the checklist items set for client upload on the template. Returns the link and a message to send on the client's channel. Sharing again replaces the previous link. The client accepts the privacy notice on that page before uploading; uploads arrive as RECEIVED for a person to verify.",
    input: uploadLinks.createUploadLinkInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => uploadLinks.createUploadLink(ctx, input),
  }),
  defineTool({
    name: "revoke_client_upload_link",
    title: "Stop the client upload link",
    description:
      "Stops the case's client upload link from working, e.g. if it was sent to the wrong person.",
    input: uploadLinks.revokeUploadLinkInput,
    annotations: { destructiveHint: true },
    visibleTo: canEdit("cases"),
    run: (ctx, input) => uploadLinks.revokeUploadLink(ctx, input),
  }),
];
