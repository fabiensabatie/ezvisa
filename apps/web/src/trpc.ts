import type { AppRouter } from "@ezvisa/server/router";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { toast } from "./lib/toast";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Do not refetch queries afterwards, e.g. issuing a download link. */
      keepCache?: boolean;
      /** The screen shows the error itself, e.g. inside a form. */
      quiet?: boolean;
    };
  }
}

function code(error: unknown): string | undefined {
  return error instanceof TRPCClientError
    ? (error.data as { code?: string } | undefined)?.code
    : undefined;
}

/** True for errors that retrying cannot fix (signed out, forbidden, not found…). */
function isClientError(error: unknown): boolean {
  const status =
    error instanceof TRPCClientError
      ? (error.data as { httpStatus?: number })?.httpStatus
      : undefined;
  return status !== undefined && status < 500;
}

/** A message a person can act on, for any error a mutation can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof TRPCClientError && !error.data) {
    return "The server cannot be reached. Check your connection and try again.";
  }
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

export function createClients(onUnauthorized: () => void) {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (code(error) === "UNAUTHORIZED") onUnauthorized();
      },
    }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        // Every write can change counts, lists and the activity feed, so refresh what is
        // on screen. The app is small enough that this beats tracking dependencies.
        if (!mutation.meta?.keepCache) void queryClient.invalidateQueries();
      },
      onError: (error, _variables, _context, mutation) => {
        if (code(error) === "UNAUTHORIZED") onUnauthorized();
        else if (!mutation.meta?.quiet) toast.error(errorMessage(error));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => !isClientError(error) && count < 2,
      },
    },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "/trpc" })],
  });
  return { queryClient, trpcClient };
}
