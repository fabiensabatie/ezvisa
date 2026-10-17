import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { Button } from "../components/controls";
import { NewCaseDialog } from "../components/NewCaseDialog";
import { Avatar, Chip, PageHeader, Progress, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { bangkokToday, daysUntil, plural, shortDate } from "../lib/format";
import { toast } from "../lib/toast";
import { DOT, dueTone, STAGES, type StageKey, stage } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";
import { OutcomeDialog } from "./CaseDetail";

type CaseList = Outputs["cases"]["list"];
type CaseSummary = CaseList["items"][number];

const BOARD = STAGES.filter((s) => s.key !== "CANCELLED");

/** Where a card may go: any other open stage, or Done (which asks how it closed). */
function canDrop(c: CaseSummary, target: StageKey): boolean {
  return target !== c.stage;
}

function CardBody({ c }: { c: CaseSummary }) {
  const days = c.dueDate ? daysUntil(c.dueDate) : null;
  return (
    <>
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
    </>
  );
}

const CARD = "block rounded-2xl border border-line bg-white p-3.5 shadow-card";

/** A case on the board: a link to the case, and draggable to another stage. */
function CaseCard({ c, draggable }: { c: CaseSummary; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: c.id,
    data: { c },
    disabled: !draggable,
  });
  // Keep the link's own role; dnd-kit would make it a button.
  const { role: _role, ...dragAttributes } = attributes;
  return (
    <Link
      ref={setNodeRef}
      to="/cases/$number"
      params={{ number: c.number }}
      {...(draggable ? { ...listeners, ...dragAttributes } : {})}
      className={`${CARD} touch-manipulation transition-transform hover:-translate-y-0.5 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <CardBody c={c} />
    </Link>
  );
}

function Column({
  s,
  count,
  dragging,
  children,
}: {
  s: (typeof BOARD)[number];
  count: number;
  dragging: CaseSummary | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: s.key });
  const allowed = dragging ? canDrop(dragging, s.key) : false;
  return (
    <section
      ref={setNodeRef}
      aria-label={s.label}
      className={`flex w-60 shrink-0 flex-col gap-2.5 rounded-3xl bg-side p-3 transition-shadow ${
        dragging && allowed ? "ring-2 ring-line" : ""
      } ${isOver && allowed ? "!ring-ink" : ""} ${dragging && !allowed && dragging.stage !== s.key ? "opacity-50" : ""}`}
    >
      <h2 className="flex items-center gap-2 px-1.5 pt-1 text-sm font-extrabold">
        <span className={`size-2.5 rounded-full ${DOT[s.tone]}`} />
        {s.label}
        <span className="ml-auto rounded-full bg-white px-2.5 py-0.5 text-xs text-text-soft">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

/** Arrow keys jump a picked-up card to the next column, rather than 25 pixels. */
const columnByColumn: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (event.code !== "ArrowRight" && event.code !== "ArrowLeft") return undefined;
  event.preventDefault();
  const centres = [...context.droppableRects.values()]
    .map((r) => ({ x: r.left + r.width / 2, y: r.top + 40 }))
    .sort((a, b) => a.x - b.x);
  const next =
    event.code === "ArrowRight"
      ? centres.find((c) => c.x > currentCoordinates.x + 10)
      : [...centres].reverse().find((c) => c.x < currentCoordinates.x - 10);
  return next ?? currentCoordinates;
};

const label = (id: unknown) => stage(String(id)).label;
const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${String(active.data.current?.c?.number ?? "the case")}.`,
  onDragOver: ({ over }) => (over ? `Over ${label(over.id)}.` : "Not over a stage."),
  onDragEnd: ({ over }) => (over ? `Dropped in ${label(over.id)}.` : "Put back."),
  onDragCancel: () => "Put back.",
};

export function CasesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = useState(true);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState<CaseSummary | null>(null);
  const [closing, setClosing] = useState<CaseSummary | null>(null);
  const { can } = useCan();
  const input = { includeClosed: showDone, limit: 100 };
  const list = useQuery(trpc.cases.list.queryOptions(input));
  const move = useMutation(trpc.cases.moveStage.mutationOptions());
  const canMove = can("cases", "edit");

  const sensors = useSensors(
    // A small movement before a drag starts, so a click still opens the case.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // On a phone, a long press picks the card up; a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnByColumn,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const c = active.data.current?.c as CaseSummary | undefined;
    const target = over?.id as StageKey | undefined;
    // The board has no Cancelled column: dropping on Done offers cancelling, with its reason.
    if (!c || !target || target === c.stage || target === "CANCELLED") return;
    if (target === "DONE") {
      setClosing(c);
      return;
    }
    // Move it now; put it back if the server refuses (its reason shows as a toast).
    const key = trpc.cases.list.queryKey(input);
    const before = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (old) =>
      old
        ? { ...old, items: old.items.map((x) => (x.id === c.id ? { ...x, stage: target } : x)) }
        : old,
    );
    move.mutate(
      { case: c.number, stage: target },
      {
        onSuccess: () => toast.success(`${c.number} moved to ${stage(target).label}`),
        onError: () => queryClient.setQueryData(key, before),
      },
    );
  }

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
        {canMove && (
          <Button icon="plus" onClick={() => setOpening(true)}>
            New case
          </Button>
        )}
      </PageHeader>
      <NewCaseDialog open={opening} onClose={() => setOpening(false)} />
      {canMove && (
        <p className="-mt-3 mb-3 text-xs text-muted">
          Drag a case to another column to move it (on a phone, press and hold).
        </p>
      )}
      <QueryView query={list} what="cases">
        {() => (
          <DndContext
            sensors={sensors}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable:
                  "To move this case to another stage, press space, use the left and right arrows, then press space again. Escape puts it back.",
              },
            }}
            onDragStart={({ active }) =>
              setDragging((active.data.current?.c as CaseSummary) ?? null)
            }
            onDragCancel={() => setDragging(null)}
            onDragEnd={onDragEnd}
          >
            <div className="-mx-4 flex items-start gap-3.5 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
              {BOARD.filter((s) => showDone || s.key !== "DONE").map((s) => {
                const cards = visible.filter((c) => c.stage === s.key);
                return (
                  <Column key={s.key} s={s} count={cards.length} dragging={dragging}>
                    {cards.map((c) => (
                      <CaseCard key={c.id} c={c} draggable={canMove && c.stage !== "DONE"} />
                    ))}
                    {cards.length === 0 && (
                      <p className="px-1.5 pb-2 text-sm text-muted">No cases here.</p>
                    )}
                  </Column>
                );
              })}
            </div>
            <DragOverlay dropAnimation={null}>
              {dragging && (
                <div className={`${CARD} w-56 rotate-2 cursor-grabbing shadow-lg`}>
                  <CardBody c={dragging} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </QueryView>
      {closing && <OutcomeDialog c={closing} open onClose={() => setClosing(null)} />}
    </>
  );
}
