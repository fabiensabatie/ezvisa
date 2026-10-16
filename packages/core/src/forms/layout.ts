/**
 * Where a flat form's blanks are, from its text layer. Claude names the printed label each
 * blank belongs to; the box is then measured from that label, in PDF points, which is exact
 * where Claude's own estimate of a position on the page is not.
 */

/** A word or phrase printed on the page. y is its baseline, from the bottom of the page. */
export type TextItem = {
  id: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextPage = {
  width: number;
  height: number;
  items: TextItem[];
  /** Where the printed text ends on the right: blanks to the end of a line stop here */
  right: number;
};

/** Which printed text a blank belongs to. */
export type Anchor = {
  /** after: the blank follows the label on its line; on: the blank is a printed run of dots or
   * underscores, or a box glyph; before: a tick box just left of its option's text */
  kind: "after" | "on" | "before";
  item: number;
  /** For after: the label that ends the blank on the same line; the line's end otherwise */
  until?: number | null;
};

export type Rect = [number, number, number, number];

const LEADER = /^[.…_—\-·\s]{3,}$/;
const LEADER_RUN = /[.…_]{3,}/g;

type PdfjsTextItem = { str?: string; transform?: number[]; width?: number; height?: number };

/** pdf.js loads with the first form read. */
async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * Reads the printed text of each page. Pieces pdf.js splits apart ("พ", ".", "ศ", ".") are
 * joined when they touch, and a label printed with its dots ("Name ......") is split so the
 * dots are an item of their own.
 */
export async function readTextLayer(bytes: Uint8Array): Promise<TextPage[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages: TextPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const content = await page.getTextContent();
      const raw = (content.items as PdfjsTextItem[])
        .filter((i) => i.str?.trim() && i.transform)
        .map((i) => ({
          text: i.str as string,
          x: (i.transform as number[])[4] as number,
          y: (i.transform as number[])[5] as number,
          width: i.width ?? 0,
          height: i.height || Math.abs((i.transform as number[])[3] ?? 0) || 10,
        }));
      const items = splitLeaders(joinTouching(raw)).map((i, id) => ({ id, ...round(i) }));
      pages.push({
        width: x1 - x0,
        height: y1 - y0,
        items,
        right: Math.max(...items.map((i) => i.x + i.width), (x1 - x0) * 0.6),
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

type Piece = Omit<TextItem, "id">;

const round = (p: Piece): Piece => ({
  text: p.text,
  x: Math.round(p.x * 10) / 10,
  y: Math.round(p.y * 10) / 10,
  width: Math.round(p.width * 10) / 10,
  height: Math.round(p.height * 10) / 10,
});

/** In reading order, with pieces on one baseline that touch joined into one. */
function joinTouching(pieces: Piece[]): Piece[] {
  const sorted = [...pieces].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? b.y - a.y : a.x - b.x));
  const out: Piece[] = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last.y - p.y) <= 1 && p.x - (last.x + last.width) < 1.5 && p.x >= last.x) {
      last.text += p.text;
      last.width = p.x + p.width - last.x;
      last.height = Math.max(last.height, p.height);
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** A character's usual width in em: dots are narrow, Thai vowel and tone marks take none. */
function charWidth(c: string): number {
  if (/\p{Mn}/u.test(c)) return 0;
  if (/[.…,:;'|!il\s]/.test(c)) return 0.28;
  if (c === "_") return 0.5;
  return /[A-Z]/.test(c) ? 0.66 : 0.55;
}

/**
 * "Name ............" becomes "Name" and "............". The item's width is shared by the
 * characters' usual widths, as pdf.js gives no position for each character.
 */
function splitLeaders(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    if (LEADER.test(p.text) || !LEADER_RUN.test(p.text)) {
      out.push(p);
      continue;
    }
    LEADER_RUN.lastIndex = 0;
    const chars = [...p.text];
    const total = chars.reduce((sum, c) => sum + charWidth(c), 0) || 1;
    // Offset of the character at a code-unit index, in points.
    const offset = (index: number) =>
      ([...p.text.slice(0, index)].reduce((sum, c) => sum + charWidth(c), 0) / total) * p.width;
    const part = (from: number, to: number) => {
      const text = p.text.slice(from, to);
      if (!text.trim()) return;
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      const x = p.x + offset(from + lead);
      out.push({ ...p, text: text.trim(), x, width: p.x + offset(to - trail) - x });
    };
    let at = 0;
    for (const match of p.text.matchAll(LEADER_RUN)) {
      const start = match.index ?? 0;
      part(at, start);
      part(start, start + match[0].length);
      at = start + match[0].length;
    }
    part(at, p.text.length);
  }
  return out;
}

/** The text listing Claude anchors blanks to: one line per item. */
export function describeTextLayer(pages: TextPage[]): string {
  return pages
    .map(
      (page, index) =>
        `Page ${index + 1} (${Math.round(page.width)} x ${Math.round(page.height)} points, y from the bottom):\n` +
        page.items
          .map(
            (i) =>
              `#${i.id} x=${Math.round(i.x)} y=${Math.round(i.y)} w=${Math.round(i.width)} ${JSON.stringify(i.text)}`,
          )
          .join("\n"),
    )
    .join("\n\n");
}

/**
 * The box of a blank from its anchor, in PDF points. Null when the anchor does not fit the
 * page (an unknown item, or a blank with no room), so the caller falls back to Claude's box.
 */
export function placeBlank(
  page: TextPage | undefined,
  anchor: Anchor | null | undefined,
  type: "text" | "checkbox",
): Rect | null {
  if (!page || !anchor) return null;
  const item = page.items[anchor.item];
  if (!item) return null;
  const height = Math.min(Math.max(item.height * 0.95, 10), 18);
  if (type === "checkbox") {
    if (anchor.kind === "on") {
      const size = Math.max(item.width, 6);
      return [item.x, item.y - size * 0.1, size, size];
    }
    const size = Math.min(Math.max(item.height * 0.6, 6), 12);
    // A box printed before its option: just left of the text, on its baseline.
    const x = anchor.kind === "before" ? item.x - size - 1 : item.x + item.width + 1;
    return [x, item.y - 0.5, size, size];
  }
  if (anchor.kind === "on") {
    if (item.width < 6) return null;
    return [item.x, item.y - 2, item.width, height];
  }
  if (anchor.kind !== "after") return null;
  const x = item.x + item.width + 1;
  const until = anchor.until == null ? null : page.items[anchor.until];
  // The closing label must be further along the same line.
  const closes = until && until.x > x && Math.abs(until.y - item.y) < 3;
  const end = closes ? until.x - 1 : page.right;
  if (end - x < 8) return null;
  return [x, item.y - 2, end - x, height];
}
