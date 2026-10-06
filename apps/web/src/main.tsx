import { applyTheme, DEFAULT_ACCENT } from "@ezvisa/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import "./styles.css";
import { storedAccent } from "./theme";
import { createClients, TRPCProvider } from "./trpc";

// Paint with the remembered colour before the first render.
applyTheme(storedAccent() ?? DEFAULT_ACCENT);

const { queryClient, trpcClient } = createClients(() => {
  if (router.state.location.pathname !== "/login") void router.navigate({ to: "/login" });
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
