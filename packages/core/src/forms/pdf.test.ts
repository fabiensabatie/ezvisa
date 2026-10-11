import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { addFields, fillPdf, inspectPdf, readPdfValues } from "./pdf.js";

/** A two-page flat form, like a scanned immigration form. */
async function flatForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const title of ["Application for extension of temporary stay", "Page 2"]) {
    const page = doc.addPage([595, 842]);
    page.drawText(title, { x: 50, y: 790, size: 14, font });
    page.drawText("Name ..............................", { x: 50, y: 700, size: 11, font });
  }
  return doc.save();
}

/** A fillable form, as some agencies keep them. */
async function fillableForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  form.createTextField("full_name").addToPage(page, { x: 100, y: 700, width: 300, height: 20 });
  const married = form.createCheckBox("married");
  married.addToPage(page, { x: 100, y: 650, width: 14, height: 14 });
  const sex = form.createRadioGroup("sex");
  sex.addOptionToPage("Male", page, { x: 100, y: 600, width: 14, height: 14 });
  sex.addOptionToPage("Female", page, { x: 150, y: 600, width: 14, height: 14 });
  return doc.save();
}

describe("PDF forms", () => {
  it("reads the fields of a fillable PDF, and none on a flat one", async () => {
    const info = await inspectPdf(await fillableForm());
    expect(info.pages).toEqual([{ width: 595, height: 842 }]);
    expect(info.fields.map((f) => [f.name, f.type, f.page])).toEqual([
      ["full_name", "text", 0],
      ["married", "checkbox", 0],
      ["sex", "radio", 0],
    ]);
    // The box includes its 1-point border.
    expect(info.fields[0]?.rect.map(Math.round)).toEqual([100, 700, 301, 21]);
    expect(info.fields[2]?.options).toEqual(["Male", "Female"]);
    expect((await inspectPdf(await flatForm())).fields).toEqual([]);
  });

  it("makes a flat PDF fillable, on the right pages", async () => {
    const fillable = await addFields(await flatForm(), [
      { name: "name", type: "text", page: 0, rect: [95, 698, 200, 16] },
      { name: "name_p2", type: "text", page: 1, rect: [95, 698, 200, 16] },
      { name: "agree", type: "checkbox", page: 1, rect: [50, 600, 12, 12] },
    ]);
    const info = await inspectPdf(fillable);
    expect(info.pages).toHaveLength(2);
    expect(info.fields.map((f) => [f.name, f.page])).toEqual([
      ["name", 0],
      ["name_p2", 1],
      ["agree", 1],
    ]);
  });

  it("fills Thai and Latin text, boxes and choices, and stays fillable", async () => {
    const filled = await fillPdf(await fillableForm(), {
      full_name: "Jo Maupas · โจ โมปา",
      married: true,
      sex: "Female",
      unknown: "ignored",
    });
    expect(await readPdfValues(filled)).toEqual({
      full_name: "Jo Maupas · โจ โมปา",
      married: true,
      sex: "Female",
    });
    // Still a form: the team can correct it in any PDF reader.
    expect((await inspectPdf(filled)).fields).toHaveLength(3);
  });
});
