import {
  type Actor,
  type Context,
  type ErrorCode,
  isDomainError,
  type Storage,
} from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";

/** Request context for the dashboard API. `actor` is null when not signed in. */
export type TrpcContext = {
  requestId: string;
  db: Db;
  storage: Storage | null;
  now: () => Date;
  actor: Actor | null;
};

const t = initTRPC.context<TrpcContext>().create();

const CODES: Record<ErrorCode, TRPCError["code"]> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  GUARD_FAILED: "PRECONDITION_FAILED",
};

/** Turns domain and validation errors into tRPC errors the dashboard can show. */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (isDomainError(cause)) {
      throw new TRPCError({ code: CODES[cause.code], message: cause.message, cause });
    }
    if (cause instanceof ZodError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: cause.issues[0]?.message, cause });
    }
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(domainErrors);

/** Requires a signed-in actor and hands resolvers a domain Context. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.actor) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
  const domain: Context = {
    actor: ctx.actor,
    via: "DASHBOARD",
    db: ctx.db,
    storage: ctx.storage,
    now: ctx.now,
  };
  return next({ ctx: { domain } });
});
