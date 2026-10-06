import { publicProcedure, router } from "./trpc.js";

/**
 * The dashboard API. The web app imports only the AppRouter type from here,
 * so this file must not pull server-only modules into its import graph.
 */
export const appRouter = router({
  health: publicProcedure.query(() => ({
    ok: true as const,
    service: "ezvisa",
    time: new Date().toISOString(),
  })),
});

export type AppRouter = typeof appRouter;
