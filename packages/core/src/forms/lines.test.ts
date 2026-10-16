import { degrees, PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { findLines, readScanLines } from "./lines.js";
import { uprightPages } from "./pdf.js";

/** A scanned form: a dotted line, a signature rule and a word, all ink, no text layer. */
async function scannedForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const black = rgb(0, 0, 0);
  page.drawLine({
    start: { x: 150, y: 700 },
    end: { x: 400, y: 700 },
    thickness: 1,
    dashArray: [1, 3],
    color: black,
  });
  page.drawLine({
    start: { x: 300, y: 200 },
    end: { x: 500, y: 200 },
    thickness: 0.8,
    color: black,
  });
  // Letters: their tops have paper above and their baselines paper below, but neither both.
  for (let i = 0; i < 20; i++) {
    page.drawRectangle({ x: 72 + i * 8, y: 650, width: 5, height: 9, color: black });
  }
  return doc.save();
}

describe("writing lines on a scan", () => {
  it("finds dotted lines and rules, not the edges of letters", async () => {
    const [page] = await readScanLines(await scannedForm());
    if (!page) throw new Error("no page");
    expect(page.items).toHaveLength(2);
    const [dotted, rule] = page.items;
    expect(dotted?.x).toBeCloseTo(150, -0.5);
    expect(Math.abs((dotted?.y ?? 0) - 700)).toBeLessThan(1.5);
    expect(dotted?.width).toBeGreaterThan(240);
    expect(Math.abs((rule?.y ?? 0) - 200)).toBeLessThan(1.5);
    expect(rule?.width).toBeGreaterThan(195);
    // The picture for Claude, with the lines numbered.
    expect([...(page.image ?? []).slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe(
      "PNG",
    );
  });

  it("reads a page stored sideways the way a viewer shows it", async () => {
    // Stored landscape and turned 270 degrees for display, like the STM.11: a writing line
    // that reads across the displayed page is drawn up the stored one.
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    page.setRotation(degrees(270));
    page.drawLine({ start: { x: 500, y: 100 }, end: { x: 500, y: 300 }, thickness: 1 });
    const upright = await uprightPages(await doc.save());
    const [shown] = await readScanLines(upright);
    expect([shown?.width, shown?.height]).toEqual([595, 842]);
    expect(shown?.items).toHaveLength(1);
    const line = shown?.items[0];
    expect(Math.abs((line?.y ?? 0) - 500)).toBeLessThan(1.5);
    expect(line?.x).toBeCloseTo(295, -0.5);
    expect(line?.width).toBeGreaterThan(195);
  });

  it("joins the pieces of a line that drifts across pixel rows", () => {
    const width = 400;
    const height = 60;
    const gray = new Uint8Array(width * height).fill(255);
    // A dotted line stepping down one row every 100 pixels, as a tilted scan does.
    for (let x = 20; x < 380; x += 6) {
      const y = 40 + Math.floor((x - 20) / 100);
      gray[y * width + x] = 0;
      gray[y * width + x + 1] = 0;
    }
    const lines = findLines(gray, width, height);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.width).toBeGreaterThan(170);
  });
});
