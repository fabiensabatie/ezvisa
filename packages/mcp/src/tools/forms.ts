import { forms } from "@ezvisa/core";
import { canEdit, canView, defineTool, type RawResult } from "../tool.js";
import { fileContent } from "./file-content.js";

const CHECK_NOTE =
  "Everything EzVisa or an assistant fills is a draft until a person checks the form with check_case_form; any later change sends it back to draft.";

export const formTools = [
  defineTool({
    name: "get_template_form",
    title: "Get a template form's fields",
    description:
      "How EzVisa fills a template's PDF form or letter: each field with its label, where its value comes from (a client or case record, \"ai\" for read from the client's documents, or null for the team), the date or text format, and a 5-minute link to the fillable PDF. Lists the possible sources and formats. Pass case to see it with case access only.",
    input: forms.templateFormInput,
    annotations: { readOnlyHint: true },
    visibleTo: (p) => canView("templates")(p) || canView("cases")(p),
    run: (ctx, input) => forms.getTemplateForm(ctx, input),
  }),
  defineTool({
    name: "set_up_template_form",
    title: "Make a template form fillable",
    description:
      "Sets a template's PDF up for filling, in the background: a PDF with its own form fields keeps them; a flat or scanned PDF gets fields where Claude finds the blanks. Claude then labels every field and picks its source. Runs by itself when a PDF form or letter is attached; call it to start over. Check back with get_template_form (settingUp turns false).",
    input: forms.analyzeTemplateFormInput,
    visibleTo: canEdit("templates"),
    run: (ctx, input) => forms.requestTemplateForm(ctx, input),
  }),
  defineTool({
    name: "update_template_form",
    title: "Change how a template form is filled",
    description:
      "Saves every field of a template form: label, source, format and hint. On a PDF EzVisa made fillable, also each box's page and rect [x, y, width, height] in PDF points from the bottom-left corner; a new name adds a box and a field left out is removed. Send the full list from get_template_form with your changes.",
    input: forms.updateTemplateFormInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("templates"),
    run: (ctx, input) => forms.updateTemplateForm(ctx, input),
  }),
  defineTool({
    name: "list_case_forms",
    title: "List a case's forms",
    description:
      "The PDF forms and letters of a case's template: whether each is set up for filling, how many fields are filled, how many are left for the team, and whether a person checked it.",
    input: forms.caseFormsInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("cases"),
    run: (ctx, input) => forms.listCaseForms(ctx, input),
  }),
  defineTool({
    name: "prepare_case_forms",
    title: "Fill a case's forms",
    description: `Fills the case's forms in the background: values from the client and case records, then the rest from what Claude reads on the client's documents. Values a person entered are kept. Runs by itself when the client has sent every document asked and when the case moves to DRAFTING. Check back with list_case_forms (preparing turns false). ${CHECK_NOTE}`,
    input: forms.caseFormsInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => forms.requestCaseForms(ctx, input),
  }),
  defineTool({
    name: "get_case_form",
    title: "Get a filled form",
    description:
      'A case\'s form field by field: value, who filled it ("source" from the records, "agent", or "person") and from what, plus 5-minute links to view or download the filled PDF.',
    input: forms.caseFormInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("cases"),
    run: (ctx, input) => forms.getCaseForm(ctx, input),
  }),
  defineTool({
    name: "read_case_form",
    title: "Read a filled form",
    description: "Returns the filled PDF itself so you can read it over before a person checks it.",
    input: forms.caseFormInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("cases"),
    run: async (ctx, input): Promise<RawResult> => {
      const { form, bytes } = await forms.readCaseForm(ctx, input);
      return {
        raw: {
          content: fileContent({
            metadata: form,
            bytes,
            mimeType: "application/pdf",
            uri: `ezvisa://cases/${form.case}/forms/${form.fileId}`,
            otherwise: "",
          }),
        },
      };
    },
  }),
  defineTool({
    name: "update_case_form",
    title: "Edit a filled form",
    description: `Sets values on a case's form by field name and makes a new PDF. Text as it should appear (dates already formatted by the field's format are kept as written; YYYY-MM-DD is formatted for you), checkboxes true or false, null to clear. ${CHECK_NOTE}`,
    input: forms.updateCaseFormInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => forms.updateCaseForm(ctx, input),
  }),
  defineTool({
    name: "check_case_form",
    title: "Mark a form checked",
    description:
      "A person confirms every value on the form is right. Assistants cannot: ask a team member to check it in the dashboard.",
    input: forms.caseFormInput,
    visibleTo: canEdit("cases"),
    run: (ctx, input) => forms.checkCaseForm(ctx, input),
  }),
];
