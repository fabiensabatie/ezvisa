import { formatDateOnly } from "../dates.js";
import { countryName } from "./countries.js";

/** Where a form field's value comes from. "ai" means an agent decides from the documents. */
export const SOURCES = [
  { key: "client.fullName", label: "Full name" },
  { key: "client.givenNames", label: "Given names" },
  { key: "client.surname", label: "Surname (family name)" },
  { key: "client.nationality", label: "Nationality (country)" },
  { key: "client.nationalityCode", label: "Nationality code (e.g. FR)" },
  { key: "client.passportNo", label: "Passport number" },
  { key: "client.dateOfBirth", label: "Date of birth" },
  { key: "client.age", label: "Age" },
  { key: "client.email", label: "Email" },
  { key: "client.phone", label: "Phone" },
  { key: "client.address", label: "Address in Thailand" },
  { key: "client.visaType", label: "Current visa" },
  { key: "client.stayUntil", label: "Permitted to stay until" },
  { key: "client.nextReportDue", label: "Next 90-day report due" },
  { key: "case.number", label: "Case number" },
  { key: "case.service", label: "Service (template name)" },
  { key: "case.dueDate", label: "Case due date" },
  { key: "agency.name", label: "Agency name" },
  { key: "today", label: "Today's date" },
] as const;

export type SourceKey = (typeof SOURCES)[number]["key"];
export const SOURCE_KEYS = SOURCES.map((s) => s.key) as readonly string[];

/** How a value is written on the form. Thai forms often want Buddhist-era years. */
export const FORMATS = [
  { key: "text", label: "As is" },
  { key: "upper", label: "CAPITALS" },
  { key: "date", label: "Date 02/04/1960" },
  { key: "date-be", label: "Date, Buddhist era 02/04/2503" },
  { key: "date-long", label: "Date 2 April 1960" },
] as const;
export type FormatKey = (typeof FORMATS)[number]["key"];

export type SourceContext = {
  client: {
    fullName: string;
    nationality: string;
    passportNo: string | null;
    dateOfBirth: Date | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    visaType: string | null;
    stayUntil: Date | null;
    nextReportDue: Date | null;
  };
  case: { number: string; service: string; dueDate: Date | null };
  agencyName: string;
  /** Bangkok date, YYYY-MM-DD */
  today: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Formats a value for a form. Dates come in as YYYY-MM-DD. */
export function formatValue(value: string, format: string | null | undefined): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (date && format?.startsWith("date")) {
    const [, y, m, d] = date;
    if (format === "date-be") return `${d}/${m}/${Number(y) + 543}`;
    if (format === "date-long") return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    return `${d}/${m}/${y}`;
  }
  return format === "upper" ? value.toUpperCase() : value;
}

function age(dob: Date, today: string): number {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const birth = formatDateOnly(dob).split("-").map(Number) as [number, number, number];
  let years = y - birth[0];
  if (m < birth[1] || (m === birth[1] && d < birth[2])) years--;
  return years;
}

/**
 * A source's value for a case, or null when the record has nothing. Names on passports put
 * the surname last in EzVisa's records; forms that need it split take the last word.
 */
export function resolveSource(key: string, ctx: SourceContext): string | null {
  const c = ctx.client;
  const words = c.fullName.trim().split(/\s+/);
  const date = (d: Date | null) => (d ? formatDateOnly(d) : null);
  switch (key) {
    case "client.fullName":
      return c.fullName;
    case "client.givenNames":
      return words.length > 1 ? words.slice(0, -1).join(" ") : c.fullName;
    case "client.surname":
      return words.length > 1 ? (words.at(-1) ?? null) : null;
    case "client.nationality":
      return countryName(c.nationality);
    case "client.nationalityCode":
      return c.nationality.toUpperCase();
    case "client.passportNo":
      return c.passportNo;
    case "client.dateOfBirth":
      return date(c.dateOfBirth);
    case "client.age":
      return c.dateOfBirth ? String(age(c.dateOfBirth, ctx.today)) : null;
    case "client.email":
      return c.email;
    case "client.phone":
      return c.phone;
    case "client.address":
      return c.address;
    case "client.visaType":
      return c.visaType;
    case "client.stayUntil":
      return date(c.stayUntil);
    case "client.nextReportDue":
      return date(c.nextReportDue);
    case "case.number":
      return ctx.case.number;
    case "case.service":
      return ctx.case.service;
    case "case.dueDate":
      return date(ctx.case.dueDate);
    case "agency.name":
      return ctx.agencyName;
    case "today":
      return ctx.today;
    default:
      return null;
  }
}
