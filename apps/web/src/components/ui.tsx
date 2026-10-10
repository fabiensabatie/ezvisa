import type { ReactNode } from "react";
import { initials } from "../lib/format";
import { pastelFor, TONE, type Tone } from "../lib/tones";
import { Icon, type IconName } from "./Icon";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl border border-line bg-white p-5 shadow-card sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  aside,
  icon,
  sub,
}: {
  children: ReactNode;
  aside?: ReactNode;
  icon?: { name: IconName; tone?: Tone };
  sub?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span
              className={`grid size-9 place-items-center rounded-xl ${TONE[icon.tone ?? "accent"]}`}
            >
              <Icon name={icon.name} size={17} />
            </span>
          )}
          <h2 className="font-display text-xl font-semibold">{children}</h2>
        </div>
        {aside}
      </div>
      {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function Chip({
  tone = "mute",
  children,
  icon,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${TONE[tone]} ${className}`}
    >
      {icon && <Icon name={icon} size={12} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

const AVATAR_SIZES = { sm: "size-7 text-[11px]", md: "size-10 text-sm", lg: "size-14 text-lg" };

export function Avatar({
  name,
  id,
  size = "md",
  square = false,
}: {
  name: string;
  id: string;
  size?: keyof typeof AVATAR_SIZES;
  square?: boolean;
}) {
  return (
    <span
      title={name}
      className={`grid shrink-0 place-items-center font-extrabold text-[#4a2f3d] ${square ? "rounded-2xl" : "rounded-full"} ${AVATAR_SIZES[size]}`}
      style={{ background: pastelFor(id) }}
    >
      {initials(name)}
    </span>
  );
}

export function Progress({
  value,
  max,
  thin = false,
}: {
  value: number;
  max: number;
  thin?: boolean;
}) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <span
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`block w-full overflow-hidden rounded-full bg-line ${thin ? "h-1.5" : "h-2.5"}`}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "accent",
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: IconName;
  tone?: Tone;
}) {
  return (
    <div className="rounded-3xl border border-line bg-white p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-muted">{label}</span>
        <span className={`grid size-9 place-items-center rounded-xl ${TONE[tone]}`}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="mt-2.5 font-display text-4xl font-semibold leading-none">{value}</div>
      <div className="mt-2 text-sm text-muted">{sub}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-bg px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-extrabold uppercase tracking-wide text-muted">{children}</div>
  );
}

/** Loading, error and forbidden states for a query; renders children once data is there. */
export function QueryView<T>({
  query,
  children,
  what = "this",
}: {
  query: {
    data: T | undefined;
    isPending: boolean;
    error: { message: string; data?: { code?: string } | null } | null;
  };
  children: (data: T) => ReactNode;
  what?: string;
}) {
  if (query.error) {
    const forbidden = query.error.data?.code === "FORBIDDEN";
    const missing = query.error.data?.code === "NOT_FOUND";
    return (
      <Card>
        <p className="font-bold">
          {forbidden
            ? `Your role cannot see ${what}.`
            : missing
              ? `${what} was not found.`
              : "Something went wrong."}
        </p>
        <p className="mt-1 text-sm text-muted">{query.error.message}</p>
      </Card>
    );
  }
  if (query.isPending || query.data === undefined) {
    return (
      <div aria-busy="true" className="space-y-4">
        <div className="h-28 animate-pulse rounded-3xl bg-white/70" />
        <div className="h-64 animate-pulse rounded-3xl bg-white/70" />
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
