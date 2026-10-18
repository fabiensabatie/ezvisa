import { templates } from "@ezvisa/core";
import { canAdminister, canEdit, canView, defineTool, type RawResult } from "../tool.js";
import { fileContent } from "./file-content.js";

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
    description: `Changes the template's name, description, office, deadline kind or prices, which apply straight away to every version, or the draft's known failures and notes. ${DRAFT_NOTE}`,
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
    description: `Uploads a small form, letter template or reference file as base64 (up to 10 MB) to the draft, optionally as the form behind a checklist item. For a file on disk or anything large, use create_template_file_upload instead: no base64. ${DRAFT_NOTE}`,
    input: templates.attachTemplateFileInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.attachTemplateFile(ctx, input),
  }),
  defineTool({
    name: "create_template_file_upload",
    title: "Start a template file upload",
    description:
      "Step 1 of 2 for adding a form, letter template or reference file to a template without base64, up to 200 MB. Returns an uploadUrl valid for 60 minutes and a ready-made curl command: PUT the file's raw bytes there from disk with its Content-Type, then call confirm_template_file_upload with the uploadKey. For many files, request every link first, then upload and confirm each.",
    input: templates.createTemplateFileUploadInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.createTemplateFileUpload(ctx, input),
  }),
  defineTool({
    name: "confirm_template_file_upload",
    title: "Finish a template file upload",
    description: `Step 2 of 2: adds the uploaded file to the template's draft under a display name and kind, optionally as the form behind a checklist item (itemId). Fails if nothing was uploaded to the uploadKey yet. ${DRAFT_NOTE}`,
    input: templates.confirmTemplateFileUploadInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.confirmTemplateFileUpload(ctx, input),
  }),
  defineTool({
    name: "get_template_file",
    title: "Get a template file",
    description:
      "A link to a template's form, letter or reference file, valid for 5 minutes, plus a ready-made curl command that saves it to disk under its name. Use it to fill in a blank form for a case with your own tools. File ids come from get_template (files) or get_case (forms, and formFileId on checklist items). Pass case to open a form of that case's template with case access only.",
    input: templates.getTemplateFileInput,
    annotations: { readOnlyHint: true },
    visibleTo: (p) => canView("templates")(p) || canView("cases")(p),
    run: (ctx, input) => templates.getTemplateFile(ctx, input),
  }),
  defineTool({
    name: "read_template_file",
    title: "Read a template file",
    description:
      "Returns a template's form or file itself so you can read it: PDFs as an embedded file, images inline, up to 10 MB (larger files: get_template_file). Use it to see which fields a form asks for. Pass case to read a form of that case's template with case access only.",
    input: templates.getTemplateFileInput,
    annotations: { readOnlyHint: true },
    visibleTo: (p) => canView("templates")(p) || canView("cases")(p),
    run: async (ctx, input): Promise<RawResult> => {
      const { file, bytes } = await templates.readTemplateFile(ctx, input);
      return {
        raw: {
          content: fileContent({
            metadata: file,
            bytes,
            mimeType: file.mimeType,
            uri: `ezvisa://template-files/${file.id}`,
            otherwise: "Use get_template_file to save it to disk.",
          }),
        },
      };
    },
  }),
  defineTool({
    name: "copy_template_file",
    title: "Copy a form or file from another template",
    description: `Copies a form, letter or reference file from any template onto this one's draft, with its fields and sources as set up there, optionally as the form behind a checklist item (itemId). Nothing is uploaded again. ${DRAFT_NOTE}`,
    input: templates.copyTemplateFileInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => templates.copyTemplateFile(ctx, input),
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
