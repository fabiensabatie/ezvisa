import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { formatDate, plural, relativeDays, shortDate } from "../lib/format";
import { CHANNEL_LABEL, DEADLINE_LABEL, dueTone, REMINDER_STATUS } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type Reminder = Outputs["reminders"]["list"]["items"][number];

function ReminderRow({ r, today }: { r: Reminder; today: string }) {
  const [open, setOpen] = useState(false);
  const status = REMINDER_STATUS[r.status] ?? { label: r.status, tone: "mute" as const };
  const deadline = r.deadline ?? today;
  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-center gap-3.5">
        <Avatar name={r.client.fullName} id={r.client.id} />
        <div className="min-w-0 flex-1 basis-56">
          <Link
            to="/clients/$clientId"
            params={{ clientId: r.client.id }}
            className="font-extrabold hover:underline"
          >
            {r.client.fullName}
          </Link>
          <div className="text-sm text-muted">
            {DEADLINE_LABEL[r.kind]} {formatDate(deadline)} · {r.offsetDays} days before
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm text-text-soft">
          <Icon name="message" size={16} />
          {CHANNEL_LABEL[r.channel] ?? r.channel}
        </span>
        <Chip tone={r.status === "DUE" ? "bad" : status.tone}>
          {r.status === "DUE" ? "Due now" : `Sends ${shortDate(r.sendOn ?? today)}`}
        </Chip>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 cursor-pointer rounded-full bg-soft px-4 text-sm font-extrabold text-ink"
        >
          {open ? "Hide message" : "Message"}
        </button>
      </div>
      {open && r.message && (
        <div className="mt-3 rounded-[20px] bg-bg p-3.5">
          <p className="max-w-xl rounded-[18px] rounded-bl-md border border-line bg-white px-4 py-3 text-sm leading-relaxed">
            {r.message}
          </p>
        </div>
      )}
    </li>
  );
}

export function RemindersPage() {
  const trpc = useTRPC();
  const reminders = useQuery(trpc.reminders.list.queryOptions({ withinDays: 30 }));
  const deadlines = useQuery(trpc.reminders.deadlines.queryOptions({ withinDays: 60 }));
  const rules = useQuery(trpc.reminders.rules.queryOptions());

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="Visa expiry and 90-day report reminders for clients"
      />
      <QueryView query={deadlines} what="reminders">
        {(d) => {
          const items = reminders.data?.items ?? [];
          const due = items.filter((r) => r.status === "DUE");
          const noCase = d.items.filter((x) => !x.openCase);
          return (
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Stays ending in 30 days"
                  value={d.items.filter((x) => x.kind === "STAY_ENDS" && x.daysLeft <= 30).length}
                  sub="permissions to stay running out"
                  icon="calendar"
                  tone="bad"
                />
                <StatTile
                  label="90-day reports in 14 days"
                  value={d.items.filter((x) => x.kind === "REPORT_DUE" && x.daysLeft <= 14).length}
                  sub="address reports coming due"
                  icon="clock"
                  tone="warn"
                />
                <StatTile
                  label="Due to send now"
                  value={due.length}
                  sub="reminders waiting to go out"
                  icon="bell"
                />
                <StatTile
                  label="No case yet"
                  value={noCase.length}
                  sub="deadlines nobody is working on"
                  icon="alert"
                  tone="info"
                />
              </div>

              <Card>
                <CardTitle sub="Rendered for each client's channel. Sending from the dashboard comes in the next milestone; for now send it yourself, or ask Claude to mark it sent.">
                  Reminders in the next 30 days
                </CardTitle>
                {items.length === 0 ? (
                  <Empty>No reminders due in the next 30 days.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {items.map((r) => (
                      <ReminderRow key={r.id} r={r} today={reminders.data?.today ?? d.today} />
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <Card>
                  <CardTitle>Upcoming deadlines</CardTitle>
                  {d.items.length === 0 ? (
                    <Empty>No deadlines in the next 60 days.</Empty>
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.items.map((x) => (
                        <li
                          key={`${x.client.id}-${x.kind}`}
                          className="flex flex-wrap items-center gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1 basis-48">
                            <Link
                              to="/clients/$clientId"
                              params={{ clientId: x.client.id }}
                              className="font-extrabold hover:underline"
                            >
                              {x.client.fullName}
                            </Link>
                            <div className="text-sm text-muted">
                              {DEADLINE_LABEL[x.kind]} {formatDate(x.deadline)}
                            </div>
                          </div>
                          {x.openCase ? (
                            <Link to="/cases/$number" params={{ number: x.openCase.number }}>
                              <Chip tone="ok">Case {x.openCase.number}</Chip>
                            </Link>
                          ) : (
                            <Chip tone="warn">No case yet</Chip>
                          )}
                          <Chip tone={dueTone(x.daysLeft)}>{relativeDays(x.daysLeft)}</Chip>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardTitle icon={{ name: "bell" }}>Reminder schedule</CardTitle>
                  <QueryView query={rules} what="the reminder schedule">
                    {(r) => (
                      <div className="flex flex-col gap-3">
                        {r.items.map((rule) => (
                          <div key={rule.kind} className="rounded-2xl bg-bg p-4">
                            <div className="flex items-center justify-between font-extrabold">
                              {DEADLINE_LABEL[rule.kind]}
                              {!rule.active && <Chip>Off</Chip>}
                            </div>
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              {rule.offsetsDays.map((o) => (
                                <span
                                  key={o}
                                  className="rounded-full border border-line bg-white px-3 py-1 text-sm font-extrabold text-ink"
                                >
                                  {plural(o, "day")} before
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </QueryView>
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
