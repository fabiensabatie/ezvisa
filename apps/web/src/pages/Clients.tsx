import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClientDialog } from "../components/ClientDialog";
import { Button } from "../components/controls";
import { Icon } from "../components/Icon";
import { Avatar, Card, Chip, Empty, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { countryName, daysUntil, formatDate, plural, relativeDays } from "../lib/format";
import { CHANNEL_LABEL, dueTone } from "../lib/tones";
import { useTRPC } from "../trpc";

const FILTERS = [
  { key: "all", label: "All clients", days: undefined },
  { key: "30", label: "Deadline within 30 days", days: 30 },
  { key: "7", label: "Within 7 days", days: 7 },
] as const;

function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function DateCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted">Not tracked</span>;
  const days = daysUntil(date);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-bold">{formatDate(date)}</span>
      {days >= -30 && days <= 90 && <Chip tone={dueTone(days)}>{relativeDays(days)}</Chip>}
    </span>
  );
}

export function ClientsPage() {
  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [adding, setAdding] = useState(false);
  const { can } = useCan();
  const term = useDebounced(search.trim());
  const days = FILTERS.find((f) => f.key === filter)?.days;
  const list = useQuery(
    trpc.clients.list.queryOptions({
      limit: 100,
      ...(term ? { search: term } : {}),
      ...(days !== undefined ? { expiringWithinDays: days } : {}),
    }),
  );

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={list.data ? `${plural(list.data.items.length, "client")} shown` : " "}
      >
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <label htmlFor="client-search" className="sr-only">
              Search clients
            </label>
            <Icon
              name="search"
              className="pointer-events-none absolute left-3.5 top-3.5 text-muted"
            />
            <input
              id="client-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, passport…"
              className="h-11 w-full rounded-full border border-line bg-white pl-10 pr-4 text-sm outline-none focus:border-accent"
            />
          </div>
          {can("clients", "edit") && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              New client
            </Button>
          )}
        </div>
      </PageHeader>
      {adding && <ClientDialog open onClose={() => setAdding(false)} />}

      <fieldset className="mb-4 flex flex-wrap gap-2">
        <legend className="sr-only">Filter clients</legend>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.key)}
              className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-extrabold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-text-soft"}`}
            >
              {f.label}
            </button>
          );
        })}
      </fieldset>

      <QueryView query={list} what="clients">
        {(data) =>
          data.items.length === 0 ? (
            <Empty>No clients match.</Empty>
          ) : (
            <Card className="!p-2 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs font-extrabold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3.5 py-3">Client</th>
                    <th className="px-3.5 py-3">Current visa</th>
                    <th className="px-3.5 py-3">Permission to stay ends</th>
                    <th className="px-3.5 py-3">Next 90-day report</th>
                    <th className="px-3.5 py-3">Consent</th>
                    <th className="px-3.5 py-3">Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} className="border-t border-line hover:bg-bg">
                      <td className="px-3.5 py-3">
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: c.id }}
                          className="flex items-center gap-3"
                        >
                          <Avatar name={c.fullName} id={c.id} />
                          <span>
                            <span className="block font-extrabold">{c.fullName}</span>
                            <span className="block text-xs text-muted">
                              {countryName(c.nationality)}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3.5 py-3 text-text-soft">{c.visaType ?? "Not recorded"}</td>
                      <td className="px-3.5 py-3">
                        <DateCell date={c.stayUntil} />
                      </td>
                      <td className="px-3.5 py-3">
                        <DateCell date={c.nextReportDue} />
                      </td>
                      <td className="px-3.5 py-3">
                        {c.consentAt ? (
                          <Chip tone="ok" icon="check">
                            Given
                          </Chip>
                        ) : (
                          <Chip tone="warn">Missing</Chip>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="inline-flex items-center gap-1.5 text-text-soft">
                          <Icon name="message" size={16} />
                          {CHANNEL_LABEL[c.channel] ?? c.channel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.nextCursor && (
                <p className="px-3.5 py-3 text-xs text-muted">
                  Showing the first 100. Refine the search to see others.
                </p>
              )}
            </Card>
          )
        }
      </QueryView>
    </>
  );
}
