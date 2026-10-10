import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../components/controls";
import { NewCaseDialog } from "../components/NewCaseDialog";
import { Avatar, Chip, PageHeader, Progress, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { bangkokToday, daysUntil, plural, shortDate } from "../lib/format";
import { DOT, dueTone, STAGES } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type CaseSummary = Outputs["cases"]["list"]["items"][number];

const BOARD = STAGES.filter((s) => s.key !== "CANCELLED");

function CaseCard({ c }: { c: CaseSummary }) {
  const days = c.dueDate ? daysUntil(c.dueDate) : null;
  return (
    <Link
      to="/cases/$number"
      params={{ number: c.number }}
      className="block rounded-2xl border border-line bg-white p-3.5 shadow-card transition-transform hover:-translate-y-0.5"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted">{c.number}</span>
        {c.progress.flagged > 0 && (
          <Chip tone="bad" icon="alert" className="!px-2 !py-0.5 !text-[11px]">
            {plural(c.progress.flagged, "flag")}
          </Chip>
        )}
      </span>
      <span className="mt-2 block font-extrabold">{c.client.fullName}</span>
      <span className="mt-0.5 block text-sm text-muted">{c.template.name}</span>
      <span className="mt-3 flex items-center gap-2">
        <Progress value={c.progress.received} max={c.progress.requiredItems} thin />
        <span className="text-xs font-extrabold text-text-soft">
          {c.progress.received}/{c.progress.requiredItems}
        </span>
      </span>
      <span className="mt-3 flex items-center justify-between gap-2">
        {c.assignee ? (
          <Avatar name={c.assignee.name} id={c.assignee.id} size="sm" />
        ) : (
          <span className="text-xs text-muted">Unassigned</span>
        )}
        {c.closedAt ? (
          <Chip tone="ok">Closed {shortDate(bangkokToday(new Date(c.closedAt)))}</Chip>
        ) : (
          c.dueDate && (
            <Chip tone={dueTone(days)} icon="clock">
              {shortDate(c.dueDate)}
            </Chip>
          )
        )}
      </span>
    </Link>
  );
}

export function CasesPage() {
  const trpc = useTRPC();
  const [showDone, setShowDone] = useState(true);
  const [opening, setOpening] = useState(false);
  const { can } = useCan();
  const list = useQuery(trpc.cases.list.queryOptions({ includeClosed: showDone, limit: 100 }));

  const monthAgo = Date.now() - 30 * 86_400_000;
  const visible = (list.data?.items ?? []).filter(
    (c) =>
      c.stage !== "CANCELLED" &&
      (c.stage !== "DONE" || (c.closedAt && Date.parse(c.closedAt) >= monthAgo)),
  );
  const open = visible.filter((c) => c.stage !== "DONE").length;

  return (
    <>
      <PageHeader title="Cases" subtitle={`${plural(open, "open case")} at Chiang Mai Immigration`}>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-4 accent-[var(--ezv-ink)]"
          />
          Show cases closed in the last 30 days
        </label>
        {can("cases", "edit") && (
          <Button icon="plus" onClick={() => setOpening(true)}>
            New case
          </Button>
        )}
      </PageHeader>
      <NewCaseDialog open={opening} onClose={() => setOpening(false)} />
      <QueryView query={list} what="cases">
        {() => (
          <div className="-mx-4 flex items-start gap-3.5 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
            {BOARD.filter((s) => showDone || s.key !== "DONE").map((s) => {
              const cards = visible.filter((c) => c.stage === s.key);
              return (
                <section
                  key={s.key}
                  aria-label={s.label}
                  className="flex w-60 shrink-0 flex-col gap-2.5 rounded-3xl bg-side p-3"
                >
                  <h2 className="flex items-center gap-2 px-1.5 pt-1 text-sm font-extrabold">
                    <span className={`size-2.5 rounded-full ${DOT[s.tone]}`} />
                    {s.label}
                    <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 text-xs text-text-soft">
                      {cards.length}
                    </span>
                  </h2>
                  {cards.map((c) => (
                    <CaseCard key={c.id} c={c} />
                  ))}
                  {cards.length === 0 && (
                    <p className="px-1.5 pb-2 text-sm text-muted">No cases here.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </QueryView>
    </>
  );
}
