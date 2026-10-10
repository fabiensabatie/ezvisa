import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  CheckboxField,
  FormDialog,
  TextAreaField,
  TextField,
} from "../components/controls";
import { Icon } from "../components/Icon";
import { NewCaseDialog } from "../components/NewCaseDialog";
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
import { useCan } from "../lib/can";
import { formatDate, plural, relativeDays, shortDate } from "../lib/format";
import { toast } from "../lib/toast";
import { CHANNEL_LABEL, DEADLINE_LABEL, dueTone, REMINDER_STATUS, stage } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Reminder = Outputs["reminders"]["list"]["items"][number];
type Deadline = Outputs["reminders"]["deadlines"]["items"][number];
type Rule = Outputs["reminders"]["rules"]["items"][number];

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ReminderRow({
  r,
  today,
  openCase,
}: {
  r: Reminder;
  today: string;
  openCase: Deadline["openCase"] | undefined;
}) {
  const trpc = useTRPC();
  const { can } = useCan();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.message ?? "");
  const markSent = useMutation(trpc.reminders.markSent.mutationOptions());
  const skip = useMutation(trpc.reminders.skip.mutationOptions());
  const status = REMINDER_STATUS[r.status] ?? { label: r.status, tone: "mute" as const };
  const pending = r.status === "DUE" || r.status === "SCHEDULED";
  const editable = pending && can("reminders", "edit");
  const channel = CHANNEL_LABEL[r.channel] ?? r.channel;
  const firstName = r.client.fullName.split(/\s+/)[0];

  async function send(message: string) {
    const copied = await copy(message);
    if (!copied) {
      setOpen(true);
      toast.error("The message could not be copied. Select it, copy it, then press Mark sent.");
      return;
    }
    markSent.mutate(
      { reminderId: r.id, ...(message !== r.message ? { message } : {}) },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(`Message copied. Paste it into ${channel} for ${firstName}.`);
        },
      },
    );
  }

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
            {DEADLINE_LABEL[r.kind]} {formatDate(r.deadline ?? today)} · {r.offsetDays} days before
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm text-text-soft">
          <Icon name="message" size={16} />
          {channel}
        </span>
        {r.status === "SENT" ? (
          <Chip tone="ok" icon="check">
            Sent
          </Chip>
        ) : openCase ? (
          <Chip tone="ok">Case open, {stage(openCase.stage).label.toLowerCase()}</Chip>
        ) : (
          <Chip tone={r.status === "DUE" ? "bad" : status.tone}>
            {r.status === "DUE" ? "Due now" : `Sends ${shortDate(r.sendOn ?? today)}`}
          </Chip>
        )}
        {pending && (
          <Button
            variant="soft"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="!px-3.5"
          >
            {open ? "Hide" : "Message"}
          </Button>
        )}
        {editable &&
          (openCase ? (
            <Link
              to="/cases/$number"
              params={{ number: openCase.number }}
              className="inline-flex min-h-11 items-center rounded-full bg-soft px-4 text-sm font-extrabold text-ink"
            >
              Open case
            </Link>
          ) : (
            <Button
              icon="send"
              pending={markSent.isPending}
              onClick={() => void send(text || r.message || "")}
            >
              Send now
            </Button>
          ))}
      </div>
      {open && pending && (
        <div className="mt-3 flex flex-col gap-3 rounded-[20px] bg-bg p-3.5">
          {editable ? (
            <TextAreaField
              label={`To ${r.client.fullName} on ${channel}`}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              hint="Edit it if you like. The text you send is saved with the reminder."
            />
          ) : (
            <p className="max-w-xl rounded-[18px] rounded-bl-md border border-line bg-white px-4 py-3 text-sm leading-relaxed">
              {r.message}
            </p>
          )}
          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                icon="skip"
                pending={skip.isPending}
                onClick={() =>
                  skip.mutate(
                    { reminderId: r.id },
                    { onSuccess: () => toast.success(`Reminder for ${firstName} skipped`) },
                  )
                }
              >
                Skip this one
              </Button>
              <Button
                variant="outline"
                icon="copy"
                onClick={async () => {
                  if (await copy(text)) toast.success("Message copied");
                }}
              >
                Copy
              </Button>
              <Button
                icon="check"
                pending={markSent.isPending}
                onClick={() =>
                  markSent.mutate(
                    { reminderId: r.id, ...(text !== r.message ? { message: text } : {}) },
                    { onSuccess: () => toast.success(`Marked sent to ${firstName}`) },
                  )
                }
              >
                Mark sent
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function DeadlineRow({ x }: { x: Deadline }) {
  const { can } = useCan();
  const [opening, setOpening] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
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
      ) : can("cases", "edit") ? (
        <Button variant="soft" icon="plus" onClick={() => setOpening(true)}>
          Open case
        </Button>
      ) : (
        <Chip tone="warn">No case yet</Chip>
      )}
      <Chip tone={dueTone(x.daysLeft)}>{relativeDays(x.daysLeft)}</Chip>
      <NewCaseDialog
        open={opening}
        onClose={() => setOpening(false)}
        client={{ id: x.client.id, fullName: x.client.fullName }}
        deadlineKind={x.kind}
      />
    </li>
  );
}

function parseOffsets(value: string): number[] | null {
  const parts = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => Number(p));
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 180)) {
    return null;
  }
  return parts;
}

function ScheduleDialog({ rules, onClose }: { rules: Rule[]; onClose: () => void }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.reminders.updateRule.mutationOptions({ meta: { quiet: true } }));
  const [drafts, setDrafts] = useState(
    rules.map((r) => ({
      kind: r.kind,
      active: r.active,
      offsets: r.offsetsDays.join(", "),
      message: r.messageTemplate,
    })),
  );
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <FormDialog
      open
      wide
      onClose={onClose}
      title="Reminder schedule"
      description="Changes apply to reminders scheduled from now on. Variables: {first_name}, {deadline}, {days_left}, {agent_name}."
      submitLabel="Save schedule"
      pending={update.isPending}
      error={problem ?? (update.error ? errorMessage(update.error) : null)}
      onSubmit={async () => {
        setProblem(null);
        for (const d of drafts) {
          const offsetsDays = parseOffsets(d.offsets);
          if (!offsetsDays) {
            setProblem(
              `${DEADLINE_LABEL[d.kind]}: list whole numbers of days from 0 to 180, e.g. 60, 30, 14, 7.`,
            );
            return;
          }
          const saved = await update
            .mutateAsync({
              kind: d.kind,
              offsetsDays,
              messageTemplate: d.message.trim(),
              active: d.active,
            })
            .catch(() => null);
          if (!saved) return;
        }
        toast.success("Reminder schedule saved");
        onClose();
      }}
    >
      {drafts.map((d, i) => (
        <fieldset key={d.kind} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <legend className="px-1 font-extrabold">{DEADLINE_LABEL[d.kind]}</legend>
          <CheckboxField
            label="Send these reminders"
            checked={d.active}
            onChange={(active) =>
              setDrafts((all) => all.map((x, j) => (j === i ? { ...x, active } : x)))
            }
          />
          <TextField
            label="Days before the deadline"
            hint="Separated by commas, e.g. 60, 30, 14, 7"
            inputMode="numeric"
            required
            value={d.offsets}
            onChange={(e) =>
              setDrafts((all) =>
                all.map((x, j) => (j === i ? { ...x, offsets: e.target.value } : x)),
              )
            }
          />
          <TextAreaField
            label="Message"
            rows={3}
            required
            value={d.message}
            onChange={(e) =>
              setDrafts((all) =>
                all.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)),
              )
            }
          />
        </fieldset>
      ))}
    </FormDialog>
  );
}

function Schedule() {
  const trpc = useTRPC();
  const { can } = useCan();
  const rules = useQuery(trpc.reminders.rules.queryOptions());
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardTitle
        icon={{ name: "bell" }}
        aside={
          can("reminders", "full") &&
          rules.data && (
            <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>
              Edit schedule
            </Button>
          )
        }
      >
        Reminder schedule
      </CardTitle>
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
      {editing && rules.data && (
        <ScheduleDialog rules={rules.data.items} onClose={() => setEditing(false)} />
      )}
    </Card>
  );
}

export function RemindersPage() {
  const trpc = useTRPC();
  const reminders = useQuery(
    trpc.reminders.list.queryOptions({ withinDays: 30, includeSentToday: true }),
  );
  // Reminders go out up to 60 days ahead of a deadline, so look further than 30 days.
  const deadlines = useQuery(trpc.reminders.deadlines.queryOptions({ withinDays: 120 }));

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="Clients get a message before their permission to stay or their 90-day report runs out"
      />
      <QueryView query={deadlines} what="reminders">
        {(d) => {
          const items = reminders.data?.items ?? [];
          const due = items.filter((r) => r.status === "DUE");
          const soon = d.items.filter((x) => x.daysLeft <= 60);
          const noCase = soon.filter((x) => !x.openCase);
          const caseFor = (r: Reminder) =>
            d.items.find((x) => x.client.id === r.client.id && x.kind === r.kind)?.openCase ??
            undefined;
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
                <CardTitle sub="Send now copies the message and marks it sent. Paste it into the client's chat. Automatic sending comes later.">
                  Reminders in the next 30 days
                </CardTitle>
                {items.length === 0 ? (
                  <Empty>No reminders due in the next 30 days.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {items.map((r) => (
                      <ReminderRow
                        key={r.id}
                        r={r}
                        today={reminders.data?.today ?? d.today}
                        openCase={caseFor(r)}
                      />
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <Card>
                  <CardTitle>Upcoming deadlines</CardTitle>
                  {soon.length === 0 ? (
                    <Empty>No deadlines in the next 60 days.</Empty>
                  ) : (
                    <ul className="divide-y divide-line">
                      {soon.map((x) => (
                        <DeadlineRow key={`${x.client.id}-${x.kind}`} x={x} />
                      ))}
                    </ul>
                  )}
                </Card>
                <Schedule />
              </div>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
