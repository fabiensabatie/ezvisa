import { THEME_PRESETS } from "@ezvisa/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Flower } from "../components/Flower";
import { Icon, type IconName } from "../components/Icon";
import { Toaster } from "../components/Toaster";
import { Avatar } from "../components/ui";
import { signOut } from "../session";
import { ThemeProvider, useTheme } from "../theme";
import { type Outputs, useTRPC } from "../trpc";

type Me = Outputs["me"];
type Counts = Outputs["navCounts"];
type NavItem = {
  to: "/" | "/cases" | "/clients" | "/reminders" | "/team" | "/templates" | "/settings";
  label: string;
  icon: IconName;
  count?: number | null;
  visible: boolean;
};

function navItems(me: Me, counts: Counts | undefined): NavItem[] {
  const p = me.permissions;
  return [
    { to: "/", label: "Overview", icon: "home", visible: p.cases !== "none" },
    {
      to: "/cases",
      label: "Cases",
      icon: "folder",
      count: counts?.openCases,
      visible: p.cases !== "none",
    },
    {
      to: "/clients",
      label: "Clients",
      icon: "users",
      count: counts?.clients,
      visible: p.clients !== "none",
    },
    {
      to: "/reminders",
      label: "Reminders",
      icon: "bell",
      count: counts?.remindersDue,
      visible: p.reminders !== "none",
    },
    { to: "/team", label: "Team & roles", icon: "badge", visible: p.team !== "none" },
    {
      to: "/templates",
      label: "Templates",
      icon: "file",
      count: counts?.templates,
      visible: p.templates !== "none",
    },
    { to: "/settings", label: "Settings", icon: "sliders", visible: true },
  ];
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items
        .filter((item) => item.visible)
        .map((item) => (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            activeOptions={{ exact: item.to === "/" }}
            className="flex min-h-11 items-center gap-3 rounded-2xl px-3.5 font-bold text-text-soft transition-colors hover:bg-white/60"
            activeProps={{ className: "bg-white !text-ink shadow-card", "aria-current": "page" }}
          >
            <Icon name={item.icon} size={20} />
            {item.label}
            {item.count !== undefined && item.count !== null && (
              <span className="ml-auto min-w-6 rounded-full bg-white px-2 py-0.5 text-center text-xs font-extrabold text-ink">
                {item.count}
              </span>
            )}
          </Link>
        ))}
    </nav>
  );
}

function ThemeSwatches() {
  const { accent, setAccent } = useTheme();
  return (
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <Icon name="heart" size={16} className="text-ink" />
        Theme colour
      </div>
      <div className="mt-2 flex flex-wrap gap-0.5">
        {THEME_PRESETS.map((preset) => {
          const on = accent === preset.hex.toLowerCase();
          return (
            <button
              key={preset.hex}
              type="button"
              aria-label={`Use the ${preset.name} theme`}
              aria-pressed={on}
              onClick={() => setAccent(preset.hex)}
              className="grid size-9 cursor-pointer place-items-center rounded-full"
            >
              <span
                className="size-6 rounded-full"
                style={{
                  background: preset.hex,
                  boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${preset.hex}` : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UserCard({ me }: { me: Me }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-white p-2.5">
      <Avatar name={me.name} id={me.employeeId} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold">{me.name}</div>
        <div className="truncate text-xs text-muted">{me.role}</div>
      </div>
      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-soft text-ink"
        onClick={async () => {
          await signOut();
          queryClient.clear();
          await navigate({ to: "/login" });
        }}
      >
        <Icon name="logout" />
      </button>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <Flower size={40} />
      <div>
        <div className="font-display text-[22px] font-semibold leading-none">EzVisa</div>
        <div className="mt-1 text-xs text-muted">Chiang Mai visa desk</div>
      </div>
    </div>
  );
}

function Shell({ me }: { me: Me }) {
  const trpc = useTRPC();
  const counts = useQuery({ ...trpc.navCounts.queryOptions(), refetchInterval: 60_000 });
  const items = navItems(me, counts.data);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-2 overflow-y-auto border-r border-line bg-side px-4 py-6 lg:flex">
        <div className="px-2 pb-5">
          <Brand />
        </div>
        <NavLinks items={items} />
        <div className="mt-auto flex flex-col gap-3 pt-5">
          <ThemeSwatches />
          <UserCard me={me} />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-side px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-11 cursor-pointer place-items-center rounded-xl bg-white text-ink"
        >
          <Icon name="menu" />
        </button>
      </header>
      {menuOpen && (
        <div className="border-b border-line bg-side px-4 pb-4 lg:hidden">
          <NavLinks items={items} onNavigate={() => setMenuOpen(false)} />
          <div className="mt-3">
            <UserCard me={me} />
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 pb-24 sm:px-8 lg:px-10 lg:py-8 lg:pb-24">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}

/** Signed-in layout. Sends anyone without a session to the sign-in page. */
export function AppShell() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());

  if (me.error) {
    if (me.error.data?.code === "UNAUTHORIZED") return <Navigate to="/login" />;
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-bold">The dashboard cannot reach the server.</p>
          <p className="mt-1 text-sm text-muted">{me.error.message}</p>
        </div>
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="grid min-h-screen place-items-center" aria-busy="true">
        <Flower size={56} />
      </div>
    );
  }
  return (
    <ThemeProvider orgAccent={me.data.settings.accent}>
      <Shell me={me.data} />
    </ThemeProvider>
  );
}
