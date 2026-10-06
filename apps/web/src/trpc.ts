import type { AppRouter } from "@ezvisa/server/router";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function createClients() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: "/trpc" })],
  });
  return { queryClient, trpcClient };
}
