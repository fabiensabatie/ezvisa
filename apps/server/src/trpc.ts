import { initTRPC } from "@trpc/server";

/** Request context for the dashboard API. Gains the signed-in actor in M2. */
export type TrpcContext = {
  requestId: string;
};

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
