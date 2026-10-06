import type { AppRouter } from "@ezvisa/server/router";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export type Outputs = inferRouterOutputs<AppRouter>;

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

export function createClients(onUnauthorized: () => void) {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (code(error) === "UNAUTHORIZED") onUnauthorized();
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
