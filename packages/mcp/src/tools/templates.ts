import { templates } from "@ezvisa/core";
import { canAdminister, canEdit, canView, defineTool } from "../tool.js";

const DRAFT_NOTE =
  "Changes go to the template's draft, which is created from the published version on the first change. Open cases are never affected; publish_template_version makes the draft apply to new cases.";

export const templateTools = [
  defineTool({
    name: "list_templates",
    title: "List templates",
    description:
      "Case templates (one per visa or service type) with their published and draft version numbers.",
    input: templates.listTemplatesInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("templates"),
    run: (ctx, input) => templates.listTemplates(ctx, input),
  }),
  defineTool({
    name: "get_template",
    title: "Get a template",
    description:
      'A template with one version in full: checklist items, forms and files, and known failures. Defaults to the published version; ask for version "draft" before editing items.',
    input: templates.getTemplateInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("templates"),
    run: (ctx, input) => templates.getTemplate(ctx, input),
  }),
  defineTool({
    name: "create_template",
    title: "Create a template",
    description:
      "Creates a template with a first draft version and, optionally, its checklist items. Publish it before opening cases with it.",
    input: templates.createTemplateInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.createTemplate(ctx, input),
  }),
  defineTool({
    name: "update_template",
    title: "Update a template",
    description: `Changes the template's name, description, office or deadline kind, or the draft's known failures and notes. ${DRAFT_NOTE}`,
    input: templates.updateTemplateInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.updateTemplate(ctx, input),
  }),
  defineTool({
    name: "add_template_item",
    title: "Add a checklist item",
    description: `Adds a checklist item to the draft, appended or at a position. ${DRAFT_NOTE}`,
    input: templates.addTemplateItemInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.addTemplateItem(ctx, input),
  }),
  defineTool({
    name: "update_template_item",
    title: "Update a checklist item",
    description: `Changes a draft checklist item. ${DRAFT_NOTE}`,
    input: templates.updateTemplateItemInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.updateTemplateItem(ctx, input),
  }),
  defineTool({
    name: "remove_template_item",
    title: "Remove a checklist item",
    description: `Removes a checklist item from the draft. ${DRAFT_NOTE}`,
    input: templates.removeTemplateItemInput,
    annotations: { destructiveHint: true },
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.removeTemplateItem(ctx, input),
  }),
  defineTool({
    name: "reorder_template_items",
    title: "Reorder checklist items",
    description: `Sets the order of the draft's items. List every draft item id exactly once. ${DRAFT_NOTE}`,
    input: templates.reorderTemplateItemsInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.reorderTemplateItems(ctx, input),
  }),
  defineTool({
    name: "attach_template_file",
    title: "Attach a form or file",
    description: `Uploads a form, letter template or reference file (base64, up to 10 MB) to the draft, optionally as the form behind a checklist item. ${DRAFT_NOTE}`,
    input: templates.attachTemplateFileInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.attachTemplateFile(ctx, input),
  }),
  defineTool({
    name: "remove_template_file",
    title: "Remove a form or file",
    description: `Removes a file from the draft and unlinks it from items. ${DRAFT_NOTE}`,
    input: templates.removeTemplateFileInput,
    annotations: { destructiveHint: true },
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.removeTemplateFile(ctx, input),
  }),
  defineTool({
    name: "publish_template_version",
    title: "Publish the draft",
    description:
      "Publishes the draft so new cases use it, and retires the previous version. Confirm with a person before publishing.",
    input: templates.publishTemplateVersionInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.publishTemplateVersion(ctx, input),
  }),
  defineTool({
    name: "archive_template",
    title: "Archive a template",
    description: "Archives a template so no new case can use it. Existing cases are unaffected.",
    input: templates.archiveTemplateInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("templates"),
    run: (ctx, input) => templates.archiveTemplate(ctx, input),
  }),
];
