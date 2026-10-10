import { z } from "zod";

export const pageInput = {
  limit: z.number().int().min(1).max(100).default(25).describe("Rows per page, 1 to 100"),
  cursor: z.string().uuid().optional().describe("nextCursor from the previous page"),
};

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Prisma arguments for a cursor page. Fetches one extra row to know if more exist. */
export function pageArgs(input: { limit: number; cursor?: string | undefined }) {
  return {
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  };
}

/** Trims the extra row and returns the cursor for the next page. */
export function toPage<R extends { id: string }, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(map),
    nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
  };
}
