import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { describeTextLayer, placeBlank, readTextLayer, type TextPage } from "./layout.js";

/** A flat form like the TM.47: labels on one line, blanks drawn between them. */
async function flatForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const text = (s: string, x: number, y: number) => page.drawText(s, { x, y, size: 12, font });
  text("Name", 72, 700);
  text("Nationality", 300, 700);
  // pdf.js reads these as separate pieces; they touch, so they are one label.
  text("B", 72, 650);
  text(".", 72 + font.widthOfTextAtSize("B", 12), 650);
  text("E.", 72 + font.widthOfTextAtSize("B.", 12), 650);
  text("Address ....................", 72, 600);
  text("TOURIST", 333, 550);
  text("Last line", 72, 500);
  return doc.save();
}

const itemOf = (page: TextPage, text: string) => {
  const item = page.items.find((i) => i.text === text);
  if (!item) throw new Error(`no item ${text}`);
  return item;
};

describe("form text layer", () => {
  it("reads labels with their positions, joining pieces and splitting printed dots", async () => {
    const [page] = await readTextLayer(await flatForm());
    if (!page) throw new Error("no page");
    expect(page.width).toBe(595);
    expect(page.items.map((i) => i.text)).toEqual([
      "Name",
      "Nationality",
      "B.E.",
      "Address",
      "....................",
      "TOURIST",
      "Last line",
    ]);
    expect(itemOf(page, "Name")).toMatchObject({ x: 72, y: 700 });
    const dots = itemOf(page, "....................");
    expect(dots.x).toBeGreaterThan(itemOf(page, "Address").x + 40);
    expect(describeTextLayer([page])).toMatch(/#0 x=72 y=700 w=\d+ "Name"/);
  });

  it("measures each blank from the text it belongs to", async () => {
    const [page] = await readTextLayer(await flatForm());
    if (!page) throw new Error("no page");
    const name = itemOf(page, "Name");
    const nationality = itemOf(page, "Nationality");

    // After a label, up to the next label on its line.
    const between = placeBlank(
      page,
      { kind: "after", item: name.id, until: nationality.id },
      "text",
    );
    expect(between?.map(Math.round)).toEqual([
      Math.round(name.x + name.width + 1),
      698,
      Math.round(nationality.x - 1 - (name.x + name.width + 1)),
      11,
    ]);
    // To the end of the line when nothing closes it, or when the closing label is elsewhere.
    const toEnd = placeBlank(page, { kind: "after", item: nationality.id, until: null }, "text");
    expect(toEnd?.[0]).toBeCloseTo(nationality.x + nationality.width + 1, 0);
    expect((toEnd?.[0] ?? 0) + (toEnd?.[2] ?? 0)).toBeCloseTo(page.right, 0);
    const wrongLine = placeBlank(
      page,
      { kind: "after", item: name.id, until: itemOf(page, "TOURIST").id },
      "text",
    );
    expect((wrongLine?.[0] ?? 0) + (wrongLine?.[2] ?? 0)).toBeCloseTo(page.right, 0);

    // On printed dots: the dots are the blank.
    const dots = itemOf(page, "....................");
    expect(placeBlank(page, { kind: "on", item: dots.id }, "text")?.[0]).toBe(dots.x);

    // A tick box just left of its option.
    const tourist = itemOf(page, "TOURIST");
    const box = placeBlank(page, { kind: "before", item: tourist.id }, "checkbox");
    expect(box?.[0]).toBeCloseTo(tourist.x - (box?.[2] ?? 0) - 1, 1);
    expect(box?.[2]).toBe(box?.[3]);

    // Nothing to measure from: the caller falls back to Claude's estimate.
    expect(placeBlank(page, null, "text")).toBeNull();
    expect(placeBlank(page, { kind: "after", item: 999 }, "text")).toBeNull();
    expect(placeBlank(undefined, { kind: "after", item: 0 }, "text")).toBeNull();
  });

  it("finds no text on a scan", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const [page] = await readTextLayer(await doc.save());
    expect(page?.items).toEqual([]);
  });
});
