import type { Prisma } from "@ezvisa/db";
import { z } from "zod";
import { DomainError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const caseRef = z
  .string()
  .trim()
  .min(1)
  .describe('Case number such as "EZ-1042", or the case id');

export const templateRef = z
  .string()
  .trim()
  .min(1)
  .describe('Template slug such as "retirement-extension", or the template id');

export const id = (what: string) => z.string().uuid().describe(`${what} id`);

/** "EZ-1042", "1042" or a UUID. */
export function caseWhere(ref: string): Prisma.CaseWhereUniqueInput {
  const value = ref.trim();
  const number = /^(?:EZ-)?(\d+)$/i.exec(value);
  if (number?.[1]) return { number: Number(number[1]) };
  if (UUID.test(value)) return { id: value };
  throw new DomainError("VALIDATION", `"${ref}" is not a case number like EZ-1042 or a case id.`);
}

export function templateWhere(ref: string): Prisma.TemplateWhereUniqueInput {
  const value = ref.trim();
  return UUID.test(value) ? { id: value } : { slug: value };
}

export function caseNumber(number: number): string {
  return `EZ-${number}`;
}

export function notFound(what: string, ref: string): DomainError {
  return new DomainError("NOT_FOUND", `No ${what} matches "${ref}".`);
}
