import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Icon } from "../components/Icon";
import {
  Avatar,
  Card,
  CardTitle,
  Chip,
  Empty,
  PageHeader,
  QueryView,
  StatTile,
} from "../components/ui";
import { dayOf, formatDate, greeting, monthOf, plural, relativeDays, timeAgo } from "../lib/format";
import { DEADLINE_LABEL, dueTone, stage, TONE } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type Overview = Outputs["overview"];

const ACTIVITY_ICON = {
  Client: "users",
  Case: "folder",
  CaseItem: "check",
  Document: "upload",
  Template: "file",
  Reminder: "bell",
} as const;

function Hero({ data, name }: { data: Overview; name: string }) {
  const needs = data.attention.length;
  const ready = data.stats.readyForImmigration;
  return (
    <section className="relative flex flex-wrap items-center gap-5 overflow-hidden rounded-[28px] bg-soft px-7 py-7">
      <div className="relative min-w-0 flex-1 basis-80">
        <h2 className="font-display text-[28px] font-semibold">
          {greeting()}, {name.split(" ")[0]}
        </h2>
        <p className="mt-2 text-text-soft">
          {needs === 0
            ? "Nothing is flagged right now"
            : `${plural(needs, "case needs", "cases need")} a look today`}
          , and {plural(ready, "pack is", "packs are")} ready for Chiang Mai Immigration.
        </p>
      </div>
      <Link
        to="/cases"
        className="relative inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 font-extrabold text-ink shadow-card"
      >
        Open the case board
        <Icon name="arrowRight" />
      </Link>
    </section>
  );
}

function Pipeline({ data }: { data: Overview }) {
  const max = Math.max(1, ...data.pipeline.map((p) => p.count));
  return (
    <Card>
      <CardTitle aside={<span className="text-sm text-muted">Done counts the last 30 days</span>}>
        Pipeline
      </CardTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {data.pipeline.map((p) => (
          <Link key={p.stage} to="/cases" className="rounded-2xl bg-bg px-4 py-3.5 hover:bg-soft">
            <span className="block text-xs font-extrabold uppercase tracking-wide text-muted">
              {stage(p.stage).label}
            </span>
            <span className="mt-1.5 block font-display text-3xl font-semibold leading-none">
              {p.count}
            </span>
            <span className="mt-3 block h-2 overflow-hidden rounded-full bg-line">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${(p.count / max) * 100}%` }}
              />
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Attention({ data }: { data: Overview }) {
  return (
    <Card>
      <CardTitle
        aside={<Chip tone={data.attention.length ? "bad" : "ok"}>{data.attention.length}</Chip>}
        sub="Flagged items, and packs due at immigration within three days."
      >
        Needs attention
      </CardTitle>
      {data.attention.length === 0 ? (
        <Empty>Nothing needs attention. Nice.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.attention.map((a) => (
            <li key={a.number}>
              <Link
                to="/cases/$number"
                params={{ number: a.number }}
                className="-mx-2 flex flex-wrap items-center gap-3.5 rounded-2xl px-2 py-3.5 hover:bg-bg"
              >
                <Avatar name={a.client.fullName} id={a.client.id} />
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-extrabold">
                    {a.client.fullName}{" "}
                    <span className="font-semibold text-muted">· {a.template}</span>
                  </div>
                  <div
                    className={`mt-1 flex items-start gap-1.5 text-sm ${a.flagCount ? "text-[#A32A2A]" : "text-[#1C5898]"}`}
                  >
                    <Icon name={a.flagCount ? "alert" : "clock"} size={15} className="mt-0.5" />
                    <span>
                      {a.flagCount > 1 ? `${a.flagCount} flags. ` : ""}
                      {a.reason}
                    </span>
                  </div>
                </div>
                {a.dueDate && (
                  <Chip tone={dueTone(a.daysLeft)}>
                    Due {formatDate(a.dueDate).replace(/ \d{4}$/, "")}
                  </Chip>
                )}
                <Chip tone="accent">{a.number}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Deadlines({ data }: { data: Overview }) {
  return (
    <Card>
      <CardTitle
        aside={
          <Link
            to="/reminders"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-soft px-4 text-sm font-extrabold text-ink"
          >
            <Icon name="bell" size={16} />
            All reminders
          </Link>
        }
        sub="Stays and 90-day reports in the next five weeks."
      >
        Upcoming deadlines
      </CardTitle>
      {data.deadlines.length === 0 ? (
        <Empty>No deadlines in the next five weeks.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.deadlines.map((d) => (
            <li key={`${d.client.id}-${d.kind}`} className="flex items-center gap-3.5 py-3">
              <span className="w-12 shrink-0 rounded-2xl bg-bg py-1.5 text-center">
                <span className="block font-display text-xl font-semibold leading-none">
                  {dayOf(d.deadline)}
                </span>
                <span className="mt-0.5 block text-[11px] font-extrabold uppercase text-muted">
                  {monthOf(d.deadline)}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: d.client.id }}
                  className="text-sm font-extrabold hover:underline"
                >
                  {d.client.fullName}
                </Link>
                <div className="text-sm text-muted">
                  {DEADLINE_LABEL[d.kind]}
                  {d.openCase ? ` · ${d.openCase.number} open` : " · no case yet"}
                </div>
              </div>
              <Chip tone={dueTone(d.daysLeft)}>{relativeDays(d.daysLeft)}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Activity({ data }: { data: Overview }) {
  return (
    <Card>
      <CardTitle>Recent activity</CardTitle>
      {data.activity.length === 0 ? (
        <Empty>No activity yet.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.activity.map((e) => (
            <li key={e.id} className="flex gap-3 py-3">
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONE.accent}`}>
                <Icon
                  name={ACTIVITY_ICON[e.kind as keyof typeof ACTIVITY_ICON] ?? "sparkle"}
                  size={17}
                />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="leading-snug">
                  <span className="font-extrabold">{e.actor}</span> {e.text}
                </div>
                <div className="mt-0.5 text-xs text-muted">{timeAgo(e.at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const trpc = useTRPC();
  const overview = useQuery({ ...trpc.overview.queryOptions(), refetchInterval: 60_000 });
  const me = useQuery(trpc.me.queryOptions());

  return (
    <>
      <PageHeader title="Overview" subtitle={formatDate(overview.data?.today)} />
      <QueryView query={overview} what="the overview">
        {(data) => (
          <div className="flex flex-col gap-5">
            <Hero data={data} name={me.data?.name ?? ""} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Open cases"
                value={data.stats.openCases}
                sub={`across ${plural(data.stats.caseTypes, "case type")}`}
                icon="folder"
              />
              <StatTile
                label="Waiting on clients"
                value={data.stats.waitingOnClients}
                sub="new or still collecting"
                icon="clock"
                tone="warn"
              />
              <StatTile
                label="Ready for immigration"
                value={data.stats.readyForImmigration}
                sub="packs approved to file"
                icon="building"
                tone="info"
              />
              <StatTile
                label="Flagged items"
                value={data.stats.flaggedItems}
                sub="to resolve before sign-off"
                icon="alert"
                tone="bad"
              />
            </div>
            <Pipeline data={data} />
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Attention data={data} />
              <div className="flex flex-col gap-5">
                <Deadlines data={data} />
                <Activity data={data} />
              </div>
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
