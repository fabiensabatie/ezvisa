import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  type PDFField,
  type PDFFont,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

/** A field of a PDF form, in PDF points with the origin at the bottom left of its page. */
export type PdfField = {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown";
  /** Choices of a radio group or dropdown */
  options?: string[];
  /** Zero-based page index */
  page: number;
  /** [x, y, width, height] */
  rect: [number, number, number, number];
  multiline?: boolean;
};

export type PdfInfo = {
  pages: Array<{ width: number; height: number }>;
  fields: PdfField[];
};

const require = createRequire(import.meta.url);
let sarabun: Uint8Array | null = null;

/** Sarabun, the Thai government typeface, with Latin too: one font fits mixed-script values. */
function sarabunBytes(): Uint8Array {
  sarabun ??= readFileSync(
    require.resolve("@expo-google-fonts/sarabun/400Regular/Sarabun_400Regular.ttf"),
  );
  return sarabun;
}

function fieldType(field: PDFField): PdfField["type"] | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "dropdown";
  return null;
}

function options(field: PDFField): string[] | undefined {
  if (
    field instanceof PDFRadioGroup ||
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList
  ) {
    return field.getOptions();
  }
  return undefined;
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/** The pages and the form fields a PDF already has. A flat scan has none. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const refs = pages.map((p) => p.ref);
  const fields: PdfField[] = [];
  for (const field of doc.getForm().getFields()) {
    const type = fieldType(field);
    if (!type) continue;
    const widget = field.acroField.getWidgets()[0];
    if (!widget) continue;
    const rect = widget.getRectangle();
    const pageRef = widget.P();
    const page = Math.max(0, pageRef ? refs.indexOf(pageRef) : 0);
    fields.push({
      name: field.getName(),
      type,
      options: options(field),
      page,
      rect: [rect.x, rect.y, rect.width, rect.height],
      multiline: field instanceof PDFTextField ? field.isMultiline() : undefined,
    });
  }
  return {
    pages: pages.map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
    fields,
  };
}

/**
 * Adds form fields to a PDF, for a flat scan: the result is a fillable PDF with the same pages.
 * Existing fields with the same name are left as they are.
 */
export async function addFields(bytes: Uint8Array, fields: PdfField[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  const existing = new Set(form.getFields().map((f) => f.getName()));
  for (const f of fields) {
    if (existing.has(f.name)) continue;
    const page = pages[f.page] ?? pages[0];
    if (!page) continue;
    const [x, y, width, height] = f.rect;
    // No background or border: the form's own dotted lines and boxes stay visible under
    // the values (pdf-lib paints fields white unless told otherwise).
    const at = {
      x,
      y,
      width,
      height,
      borderWidth: 0,
      backgroundColor: undefined,
      borderColor: undefined,
    };
    if (f.type === "checkbox") {
      form.createCheckBox(f.name).addToPage(page, at);
    } else if (f.type === "dropdown" && f.options?.length) {
      const dropdown = form.createDropdown(f.name);
      dropdown.addOptions(f.options);
      dropdown.addToPage(page, at);
    } else {
      const text = form.createTextField(f.name);
      if (f.multiline) text.enableMultiline();
      text.addToPage(page, at);
    }
    existing.add(f.name);
  }
  return doc.save();
}

export type FillValue = string | boolean | null | undefined;

/** Fits text in a field: a smaller size for long values in single-line fields. */
function fitSize(font: PDFFont, text: string, width: number, height: number): number {
  const max = Math.min(11, Math.max(6, height * 0.7));
  for (let size = max; size > 5; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width - 4) return size;
  }
  return 5;
}

/**
 * Fills a fillable PDF. Text is drawn in Sarabun, so Thai and Latin both show; the fields
 * stay editable in any PDF reader. Values for unknown fields are ignored.
 */
export async function fillPdf(
  bytes: Uint8Array,
  values: Record<string, FillValue>,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(sarabunBytes(), { subset: true });
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const value = values[field.getName()];
    if (value === undefined || value === null) continue;
    if (field instanceof PDFTextField) {
      const text = String(value);
      const max = field.getMaxLength();
      field.setText(max ? text.slice(0, max) : text);
      const widget = field.acroField.getWidgets()[0];
      if (widget && !field.isMultiline()) {
        const r = widget.getRectangle();
        field.setFontSize(fitSize(font, text, r.width, r.height));
      }
    } else if (field instanceof PDFCheckBox) {
      if (value === true || value === "true" || value === "yes" || value === "Yes") field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value === "string" && field.getOptions().includes(value)) field.select(value);
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (typeof value === "string" && field.getOptions().includes(value)) field.select(value);
    }
  }
  form.updateFieldAppearances(font);
  return doc.save();
}

/** The values a filled PDF holds, for checking a fill. */
export async function readPdfValues(bytes: Uint8Array): Promise<Record<string, string | boolean>> {
  const doc = await load(bytes);
  const out: Record<string, string | boolean> = {};
  for (const field of doc.getForm().getFields()) {
    if (field instanceof PDFTextField) out[field.getName()] = field.getText() ?? "";
    else if (field instanceof PDFCheckBox) out[field.getName()] = field.isChecked();
    else if (field instanceof PDFRadioGroup) out[field.getName()] = field.getSelected() ?? "";
    else if (field instanceof PDFDropdown) out[field.getName()] = field.getSelected()[0] ?? "";
  }
  return out;
}
