import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { AppShell } from "./layout/AppShell";
import { CaseDetailPage } from "./pages/CaseDetail";
import { CasesPage } from "./pages/Cases";
import { ClientDetailPage } from "./pages/ClientDetail";
import { ClientsPage } from "./pages/Clients";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { RemindersPage } from "./pages/Reminders";
import { SettingsPage } from "./pages/Settings";
import { TeamPage } from "./pages/Team";
import { TemplateDetailPage, TemplatesPage } from "./pages/Templates";

function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <p className="font-display text-2xl font-semibold">This page does not exist.</p>
        <Link
          to="/"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-extrabold text-white"
        >
          Back to the overview
        </Link>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: AppShell,
});

const parent = () => shellRoute;

export const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    createRoute({ getParentRoute: parent, path: "/", component: OverviewPage }),
    createRoute({ getParentRoute: parent, path: "/cases", component: CasesPage }),
    createRoute({ getParentRoute: parent, path: "/cases/$number", component: CaseDetailPage }),
    createRoute({ getParentRoute: parent, path: "/clients", component: ClientsPage }),
    createRoute({
      getParentRoute: parent,
      path: "/clients/$clientId",
      component: ClientDetailPage,
    }),
    createRoute({ getParentRoute: parent, path: "/reminders", component: RemindersPage }),
    createRoute({ getParentRoute: parent, path: "/team", component: TeamPage }),
    createRoute({ getParentRoute: parent, path: "/templates", component: TemplatesPage }),
    createRoute({
      getParentRoute: parent,
      path: "/templates/$slug",
      component: TemplateDetailPage,
    }),
    createRoute({ getParentRoute: parent, path: "/settings", component: SettingsPage }),
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
