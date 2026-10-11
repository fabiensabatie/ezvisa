const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** "FR" → "France", for forms that want the nationality written out. */
export function countryName(code: string): string {
  const upper = code.trim().toUpperCase();
  try {
    return regions.of(upper) ?? upper;
  } catch {
    return upper;
  }
}
