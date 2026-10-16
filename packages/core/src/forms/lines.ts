/**
 * Writing lines on a scanned form. A scan has no text to anchor blanks to, but its dotted and
 * solid writing lines are in the image: EzVisa finds them, numbers them on a picture of the
 * page for Claude, and Claude says which line each blank is written on.
 */
import type { TextItem, TextPage } from "./layout.js";

/** Pixels per PDF point when looking for lines. */
const SCALE = 2;
/** Darker than this (0-255) is ink. */
const INK = 150;

type Canvas = {
  getContext(kind: "2d"): Context2d;
  toBuffer(mime: "image/png"): Uint8Array;
};
type Context2d = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
};

/** A line found on a page, in PDF points: y is the line itself, from the bottom of the page. */
export type FoundLine = { x: number; y: number; width: number };

/**
 * Finds horizontal writing lines in a grayscale page: runs of ink with nothing printed just
 * above them (dots and rules, not the bottom of letters), joined across gaps between dots.
 */
export function findLines(gray: Uint8Array, width: number, height: number, scale = SCALE) {
  const ink = (x: number, y: number) => (gray[y * width + x] ?? 255) < INK;
  // A dot or a rule has clear paper above and below it. A letter does not: its body fills the
  // band above its baseline, and the band below the top of its strokes.
  const above = [Math.round(1.5 * scale), Math.round(7 * scale)] as const;
  const below = [Math.round(1.5 * scale), Math.round(5.5 * scale)] as const;
  const maxGap = Math.round(6 * scale);
  const minLength = Math.round(15 * scale);
  // A scanned line may break into short pieces; specks of dust are shorter still.
  const minPiece = Math.round(4 * scale);
  const clear = (x: number, y: number, from: number, to: number, sign: 1 | -1) => {
    for (let d = from; d <= to; d++) {
      const yy = y + sign * d;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < width && ink(xx, yy)) return false;
      }
    }
    return true;
  };
  const isRule = (x: number, y: number) =>
    clear(x, y, above[0], above[1], -1) && clear(x, y, below[0], below[1], 1);
  type Run = { x1: number; x2: number; y: number; count: number };
  const runs: Run[] = [];
  for (let y = above[1]; y < height; y++) {
    let start = -1;
    let last = -1;
    let count = 0;
    const close = () => {
      if (start >= 0 && last - start >= minPiece && count / (last - start + 1) >= 0.18) {
        runs.push({ x1: start, x2: last, y, count });
      }
      start = -1;
      count = 0;
    };
    for (let x = 0; x < width; x++) {
      if (!ink(x, y) || !isRule(x, y)) continue;
      if (start >= 0 && x - last > maxGap) close();
      if (start < 0) start = x;
      last = x;
      count++;
    }
    close();
  }
  // A dotted line is a few pixel rows tall, and a scanned one drifts a little: pieces on
  // nearly the same row that overlap or meet end to end are one line, kept at its lowest row.
  const band = Math.round(2.5 * scale);
  const touches = (a: Run, b: Run) =>
    Math.abs(a.y - b.y) <= band && a.x1 <= b.x2 + maxGap && a.x2 >= b.x1 - maxGap;
  const lines: Run[] = [];
  for (const run of runs) {
    const same = lines.find((l) => touches(run, l));
    if (same) {
      same.y = Math.max(same.y, run.y);
      same.x1 = Math.min(same.x1, run.x1);
      same.x2 = Math.max(same.x2, run.x2);
    } else {
      lines.push({ ...run });
    }
  }
  // Lines that grew until they meet are joined too.
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < lines.length && !joined; i++) {
      for (let j = i + 1; j < lines.length && !joined; j++) {
        const a = lines[i] as Run;
        const b = lines[j] as Run;
        if (!touches(a, b)) continue;
        a.y = Math.max(a.y, b.y);
        a.x1 = Math.min(a.x1, b.x1);
        a.x2 = Math.max(a.x2, b.x2);
        lines.splice(j, 1);
        joined = true;
      }
    }
  }
  return lines
    .filter((l) => l.x2 - l.x1 >= minLength)
    .map((l) => ({
      x: l.x1 / scale,
      y: (height - l.y) / scale,
      width: (l.x2 - l.x1) / scale,
    }));
}

/** pdf.js loads with the first form read. */
async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * The writing lines of each page of a scan, as text-layer items Claude can anchor to, with a
 * picture of each page where every line carries its #id in red.
 */
export async function readScanLines(
  bytes: Uint8Array,
): Promise<Array<TextPage & { image: Uint8Array }>> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    const factory = doc.canvasFactory as {
      create(w: number, h: number): { canvas: Canvas; context: Context2d };
    };
    const pages: Array<TextPage & { image: Uint8Array }> = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const w = Math.ceil(viewport.width);
      const h = Math.ceil(viewport.height);
      const { canvas, context } = factory.create(w, h);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, w, h);
      await page.render({ canvas, canvasContext: context, viewport } as never).promise;
      const rgba = context.getImageData(0, 0, w, h).data;
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) {
        gray[i] =
          0.299 * (rgba[i * 4] ?? 255) +
          0.587 * (rgba[i * 4 + 1] ?? 255) +
          0.114 * (rgba[i * 4 + 2] ?? 255);
      }
      const items: TextItem[] = findLines(gray, w, h).map((l, id) => ({
        id,
        text: "printed line",
        x: Math.round(l.x * 10) / 10,
        y: Math.round(l.y * 10) / 10,
        width: Math.round(l.width * 10) / 10,
        height: 14,
      }));
      // Number each line on the picture, at its left end, for Claude to name.
      context.font = `bold ${9 * SCALE}px sans-serif`;
      context.lineWidth = SCALE;
      for (const item of items) {
        const px = item.x * SCALE;
        const py = h - item.y * SCALE;
        context.strokeStyle = "rgba(220,0,0,0.9)";
        context.strokeRect(px, py - 1, item.width * SCALE, 2);
        context.fillStyle = "rgba(220,0,0,1)";
        context.fillText(`#${item.id}`, Math.max(0, px - 2), py - 3 * SCALE);
      }
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      pages.push({
        width: x1 - x0,
        height: y1 - y0,
        items,
        right: Math.max(...items.map((i) => i.x + i.width), (x1 - x0) * 0.6),
        image: canvas.toBuffer("image/png"),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
