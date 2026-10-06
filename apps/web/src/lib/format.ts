// Dates: business dates are YYYY-MM-DD in Asia/Bangkok (UTC+7, no daylight saving).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export function bangkokToday(now = new Date()): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

function parts(date: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = date.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** "14 Oct 2026" */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "Not set";
  const [y, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "14 Oct" */
export function shortDate(date: string): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

export function monthOf(date: string): string {
  return MONTHS[parts(date)[1] - 1] ?? "";
}

export function dayOf(date: string): number {
  return parts(date)[2];
}

export function daysUntil(date: string, today = bangkokToday()): number {
  return Math.round(
    (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
}

/** "today", "tomorrow", "in 5 days", "3 days ago" */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** "5 min ago", "3 hours ago", "2 Oct" */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "yesterday";
  return shortDate(bangkokToday(new Date(iso)));
}

export function greeting(now = new Date()): string {
  const hour = new Date(now.getTime() + BANGKOK_OFFSET_MS).getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const COUNTRIES: Record<string, string> = {
  AU: "Australia",
  BR: "Brazil",
  CA: "Canada",
  CN: "China",
  DE: "Germany",
  DK: "Denmark",
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  IE: "Ireland",
  IN: "India",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  NL: "Netherlands",
  NO: "Norway",
  NZ: "New Zealand",
  RU: "Russia",
  SE: "Sweden",
  SG: "Singapore",
  TH: "Thailand",
  US: "United States",
};

export function countryName(code: string): string {
  return COUNTRIES[code.toUpperCase()] ?? code.toUpperCase();
}
