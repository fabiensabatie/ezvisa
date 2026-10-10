import { z } from "zod";

/** Business dates are calendar dates in Asia/Bangkok (UTC+7, no daylight saving). */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Zod schema for a YYYY-MM-DD calendar date. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");

/** Today's date in Bangkok, as YYYY-MM-DD. */
export function bangkokToday(now: Date): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Converts YYYY-MM-DD to the Date Prisma stores in a `@db.Date` column. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Formats a `@db.Date` value as YYYY-MM-DD. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function formatDateOnlyOrNull(value: Date | null | undefined): string | null {
  return value ? formatDateOnly(value) : null;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return formatDateOnly(new Date(parseDateOnly(date).getTime() + days * DAY_MS));
}

/** Short human form for messages, e.g. "27 Oct". */
export function formatShortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}
