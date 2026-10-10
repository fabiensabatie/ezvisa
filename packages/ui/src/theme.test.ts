import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DEFAULT_ACCENT,
  normalizeHex,
  THEME_PRESETS,
  themeCssVariables,
  themeFor,
} from "./theme";

const ACCENTS = [
  ...THEME_PRESETS.map((p) => p.hex),
  "#0000ff",
  "#ffd400",
  "#00ffff",
  "#7fff00",
  "#ffffff",
  "#000000",
  "#808080",
];

describe("themeFor", () => {
  it.each(ACCENTS)("keeps text readable for %s", (accent) => {
    const t = themeFor(accent);
    expect(contrastRatio(t.ink, "#ffffff")).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(t.ink, t.soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(t.textSoft, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the accent itself and falls back on invalid input", () => {
    expect(themeFor("#EC5F9E").accent).toBe("#ec5f9e");
    expect(themeFor("not a colour").accent).toBe(DEFAULT_ACCENT.toLowerCase());
  });

  it("produces one CSS variable per token", () => {
    const vars = themeCssVariables(themeFor(DEFAULT_ACCENT));
    expect(vars["--ezv-accent"]).toBe("#ec5f9e");
    expect(Object.keys(vars)).toHaveLength(14);
    expect(Object.keys(vars).every((k) => k.startsWith("--ezv-"))).toBe(true);
  });
});

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit hex with or without #", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("ec5f9e")).toBe("#ec5f9e");
    expect(normalizeHex(" #EC5F9E ")).toBe("#ec5f9e");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("pink")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});
