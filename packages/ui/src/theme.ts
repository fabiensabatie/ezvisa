/**
 * Derives the whole dashboard palette from one accent colour, as in the mockup.
 * Text and button colours are darkened until they meet WCAG contrast on the
 * surfaces they sit on, so any accent a person picks stays readable.
 */

export const DEFAULT_ACCENT = "#EC5F9E";

export const THEME_PRESETS = [
  { name: "Sakura", hex: "#EC5F9E" },
  { name: "Lavender", hex: "#9A7BE6" },
  { name: "Mint", hex: "#2DB38A" },
  { name: "Sky", hex: "#3A97E6" },
  { name: "Peach", hex: "#F08A4B" },
] as const;

export type Theme = {
  accent: string;
  /** Buttons and accent text. At least 6:1 on white and 4.6:1 on `soft`. */
  ink: string;
  text: string;
  textSoft: string;
  /** Secondary text. At least 4.5:1 on `bg`. */
  muted: string;
  bg: string;
  side: string;
  soft: string;
  soft2: string;
  line: string;
  petal: string;
  petalLight: string;
  shadow: string;
  shadowLg: string;
};

type Rgb = [number, number, number];

const WHITE = "#ffffff";
const DEEP = "#1f1219";

/** Returns a lowercase #rrggbb, or null when the input is not a hex colour. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt((normalizeHex(hex) ?? DEFAULT_ACCENT).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Linear mix: 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
}

function luminance(hex: string): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return toRgb(hex).reduce((sum, v, i) => {
    const c = v / 255;
    const linear = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return sum + (weights[i] ?? 0) * linear;
  }, 0);
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Darkens `color` until it meets every minimum contrast against its backgrounds. */
function darkenUntil(color: string, targets: Array<[background: string, min: number]>): string {
  let result = color;
  for (let amount = 0; amount <= 1; amount += 0.02) {
    result = mix(color, DEEP, amount);
    if (targets.every(([bg, min]) => contrastRatio(result, bg) >= min)) return result;
  }
  return result;
}

export function themeFor(accentInput: string): Theme {
  const accent = normalizeHex(accentInput) ?? DEFAULT_ACCENT.toLowerCase();
  const [r, g, b] = toRgb(accent);
  const bg = mix(accent, WHITE, 0.95);
  const soft = mix(accent, WHITE, 0.86);

  return {
    accent,
    ink: darkenUntil(accent, [
      [WHITE, 6],
      [soft, 4.6],
    ]),
    text: darkenUntil(mix(accent, "#24161e", 0.9), [[bg, 12]]),
    textSoft: darkenUntil(mix(accent, "#4a3b44", 0.8), [[bg, 7]]),
    muted: darkenUntil(mix(accent, "#6f5d68", 0.82), [[bg, 4.8]]),
    bg,
    side: mix(accent, WHITE, 0.9),
    soft,
    soft2: mix(accent, WHITE, 0.72),
    line: mix(accent, WHITE, 0.82),
    petal: mix(accent, WHITE, 0.5),
    petalLight: mix(accent, WHITE, 0.8),
    shadow: `0 1px 2px rgba(${r},${g},${b},0.08), 0 8px 24px rgba(${r},${g},${b},0.08)`,
    shadowLg: `0 2px 6px rgba(${r},${g},${b},0.10), 0 24px 60px rgba(${r},${g},${b},0.18)`,
  };
}

const CSS_NAMES: Record<keyof Theme, string> = {
  accent: "--ezv-accent",
  ink: "--ezv-ink",
  text: "--ezv-text",
  textSoft: "--ezv-text-soft",
  muted: "--ezv-muted",
  bg: "--ezv-bg",
  side: "--ezv-side",
  soft: "--ezv-soft",
  soft2: "--ezv-soft-2",
  line: "--ezv-line",
  petal: "--ezv-petal",
  petalLight: "--ezv-petal-light",
  shadow: "--ezv-shadow",
  shadowLg: "--ezv-shadow-lg",
};

/** CSS custom properties for a theme, read by Tailwind through `@theme inline`. */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of Object.keys(CSS_NAMES) as Array<keyof Theme>) {
    vars[CSS_NAMES[key]] = theme[key];
  }
  return vars;
}

/** Writes the theme for `accent` onto an element, the document root by default. */
export function applyTheme(accent: string, root: HTMLElement = document.documentElement): Theme {
  const theme = themeFor(accent);
  for (const [name, value] of Object.entries(themeCssVariables(theme))) {
    root.style.setProperty(name, value);
  }
  return theme;
}
