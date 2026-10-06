import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { DocumentList } from "../components/DocumentList";
import { Icon } from "../components/Icon";
import { Avatar, Card, CardTitle, Chip, Label, Progress, QueryView } from "../components/ui";
import { daysUntil, formatDate, relativeDays, timeAgo } from "../lib/format";
import { dueTone, ITEM_STATUS, STAGES, stage, TONE } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type CaseDetail = Outputs["cases"]["get"];

const FLOW = STAGES.filter((s) => s.key !== "CANCELLED");

function Stepper({ current }: { current: string }) {
  const index = FLOW.findIndex((s) => s.key === current);
  return (
    <ol aria-label="Case stages" className="flex overflow-x-auto">
      {FLOW.map((s, i) => {
        const done = i < index;
        const here = i === index;
        return (
          <li
            key={s.key}
            className="flex min-w-28 flex-1 flex-col gap-2"
            aria-current={here ? "step" : undefined}
          >
            <span className="flex items-center">
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-extrabold ${
                  done
                    ? "border-transparent bg-accent text-white"
                    : here
                      ? "border-transparent bg-ink text-white"
                      : "border-line bg-white text-muted"
                }`}
              >
                {done ? <Icon name="check" size={15} strokeWidth={3} /> : i + 1}
              </span>
              {i < FLOW.length - 1 && (
                <span
                  className={`mx-2 h-[3px] flex-1 rounded-full ${done ? "bg-accent" : "bg-line"}`}
                />
              )}
            </span>
            <span className={`text-sm ${here ? "font-extrabold" : "font-semibold text-muted"}`}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Header({ c }: { c: CaseDetail }) {
  const days = c.dueDate ? daysUntil(c.dueDate) : null;
  const s = stage(c.stage);
  return (
    <Card className="flex flex-wrap items-center gap-5">
      <Avatar name={c.client.fullName} id={c.client.id} size="lg" square />
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-2xl font-semibold">
            <Link
              to="/clients/$clientId"
              params={{ clientId: c.client.id }}
              className="hover:underline"
            >
              {c.client.fullName}
            </Link>
          </h1>
          <Chip tone={s.tone}>{s.label}</Chip>
          {c.outcome && (
            <Chip tone={c.outcome === "APPROVED" ? "ok" : "bad"}>{c.outcome.toLowerCase()}</Chip>
          )}
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {c.number} · {c.template.name} v{c.template.version} · opened {timeAgo(c.createdAt ?? "")}
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <Label>Assigned to</Label>
          <div className="mt-1.5 flex items-center gap-2 font-extrabold">
            {c.assignee ? (
              <>
                <Avatar name={c.assignee.name} id={c.assignee.id} size="sm" />
                {c.assignee.name}
              </>
            ) : (
              <span className="text-muted">Nobody yet</span>
            )}
          </div>
        </div>
        <div>
          <Label>Due at immigration</Label>
          <div className="mt-1.5 flex items-center gap-2 font-extrabold">
            {c.dueDate ? (
              <>
                {formatDate(c.dueDate)}
                {!c.closedAt && <Chip tone={dueTone(days)}>{relativeDays(days ?? 0)}</Chip>}
              </>
            ) : (
              <span className="text-muted">Not set</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Checklist({ c }: { c: CaseDetail }) {
  return (
    <Card>
      <CardTitle
        aside={
          <span className="text-sm font-extrabold text-text-soft">
            {c.progress.verified} of {c.progress.requiredItems} verified
          </span>
        }
      >
        Checklist
      </CardTitle>
      <div className="mb-3">
        <Progress value={c.progress.received} max={c.progress.requiredItems} />
        <p className="mt-1.5 text-xs text-muted">
          {c.progress.received} of {c.progress.requiredItems} required items received
        </p>
      </div>
      <ul className="flex flex-col gap-0.5">
        {c.items.map((item) => {
          const status = ITEM_STATUS[item.status] ?? { label: item.status, tone: "mute" as const };
          return (
            <li
              key={item.id}
              className={`flex items-start gap-3 rounded-2xl px-2.5 py-2.5 ${item.status === "FLAGGED" ? "bg-[#FFF5F5]" : ""}`}
            >
              <span
                className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${TONE[status.tone]}`}
              >
                <Icon
                  name={
                    item.status === "FLAGGED"
                      ? "alert"
                      : item.status === "MISSING"
                        ? "clock"
                        : "check"
                  }
                  size={14}
                  strokeWidth={2.6}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{item.label}</span>
                  {!item.required && <Chip>Optional</Chip>}
                </div>
                <div
                  className={`mt-0.5 text-sm ${item.status === "FLAGGED" ? "text-[#A32A2A]" : "text-muted"}`}
                >
                  {item.note ?? status.label}
                  {item.flaggedBy === "ASSISTANT" && " · flagged by the assistant"}
                  {item.documentIds.length > 0 &&
                    ` · ${item.documentIds.length} document${item.documentIds.length > 1 ? "s" : ""}`}
                </div>
              </div>
              <Chip tone={status.tone}>{status.label}</Chip>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Documents({ c }: { c: CaseDetail }) {
  return (
    <Card>
      <CardTitle icon={{ name: "upload" }}>Documents</CardTitle>
      <DocumentList documents={c.documents} empty="No documents yet." />
    </Card>
  );
}

function Failures({ c }: { c: CaseDetail }) {
  if (c.knownFailures.length === 0) return null;
  return (
    <Card>
      <CardTitle
        icon={{ name: "alert", tone: "warn" }}
        sub="From past rejections. The assistant checks documents against these."
      >
        Known failures
      </CardTitle>
      <ul className="flex flex-col gap-2">
        {c.knownFailures.map((f) => (
          <li key={f} className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
            {f}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CaseDetailPage() {
  const { number } = useParams({ strict: false }) as { number: string };
  const trpc = useTRPC();
  const query = useQuery(trpc.cases.get.queryOptions({ case: number }));

  return (
    <>
      <Link
        to="/cases"
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 font-extrabold text-ink"
      >
        <Icon name="arrowLeft" />
        All cases
      </Link>
      <QueryView query={query} what={`Case ${number}`}>
        {(c) => (
          <div className="flex flex-col gap-5">
            <Header c={c} />
            <Card>
              <Stepper current={c.stage} />
            </Card>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Checklist c={c} />
              <div className="flex flex-col gap-5">
                <Documents c={c} />
                <Failures c={c} />
                {c.notes && (
                  <Card>
                    <CardTitle>Notes</CardTitle>
                    <p className="whitespace-pre-line text-sm text-text-soft">{c.notes}</p>
                  </Card>
                )}
              </div>
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
