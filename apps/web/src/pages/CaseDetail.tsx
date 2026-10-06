import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Button,
  FieldRow,
  FormDialog,
  IconButton,
  nullable,
  RadioCards,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/controls";
import { DocumentList, FileDrop, useDocumentUpload } from "../components/DocumentList";
import { Icon } from "../components/Icon";
import { Avatar, Card, CardTitle, Chip, Label, Progress, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { daysUntil, formatDate, relativeDays, timeAgo } from "../lib/format";
import { toast } from "../lib/toast";
import { dueTone, ITEM_STATUS, STAGES, stage, TONE } from "../lib/tones";
import { ACCEPT } from "../lib/upload";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type CaseDetail = Outputs["cases"]["get"];
type Item = CaseDetail["items"][number];
type ItemStatus = Item["status"];
type OpenStage = "NEW" | "COLLECTING" | "DRAFTING" | "VALIDATION" | "SUBMISSION";

const FLOW = STAGES.filter((s) => s.key !== "CANCELLED");
const OPEN_STAGES = STAGES.filter((s) => !["DONE", "CANCELLED"].includes(s.key));

/** The one obvious next step for each stage, as in the mockup's header button. */
const NEXT: Partial<Record<string, { to: OpenStage; label: string }>> = {
  NEW: { to: "COLLECTING", label: "Start collecting" },
  COLLECTING: { to: "DRAFTING", label: "Move to drafting" },
  DRAFTING: { to: "VALIDATION", label: "Send for validation" },
  VALIDATION: { to: "SUBMISSION", label: "Approve the pack" },
};

const isOpen = (c: CaseDetail) => c.stage !== "DONE" && c.stage !== "CANCELLED";

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

// ---- header and stage actions --------------------------------------------------

function StageAction({ c, onOutcome }: { c: CaseDetail; onOutcome: () => void }) {
  const trpc = useTRPC();
  const { can, approvePacks, markSubmitted, human } = useCan();
  const move = useMutation(trpc.cases.moveStage.mutationOptions());
  if (!isOpen(c) || !can("cases", "edit")) return null;

  if (c.stage === "SUBMISSION") {
    return markSubmitted ? (
      <Button icon="send" onClick={onOutcome}>
        Log the outcome
      </Button>
    ) : (
      <Chip tone="info">Waiting for the runner</Chip>
    );
  }
  const next = NEXT[c.stage];
  if (!next) return null;
  if (next.to === "SUBMISSION" && !(approvePacks && human)) {
    return <Chip tone="accent">Waiting for approval</Chip>;
  }
  return (
    <Button
      icon={next.to === "SUBMISSION" ? "check" : "arrowRight"}
      pending={move.isPending}
      onClick={() =>
        move.mutate(
          { case: c.number, stage: next.to },
          { onSuccess: () => toast.success(`${c.number} moved to ${stage(next.to).label}`) },
        )
      }
    >
      {next.label}
    </Button>
  );
}

function Header({ c }: { c: CaseDetail }) {
  const { can } = useCan();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState(false);
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
      {isOpen(c) && can("cases", "edit") && (
        <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>
            Edit case
          </Button>
          <StageAction c={c} onOutcome={() => setOutcome(true)} />
        </div>
      )}
      {editing && <EditCaseDialog c={c} open onClose={() => setEditing(false)} />}
      {outcome && <OutcomeDialog c={c} open onClose={() => setOutcome(false)} />}
    </Card>
  );
}

function EditCaseDialog({
  c,
  open,
  onClose,
}: {
  c: CaseDetail;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const assignees = useQuery({ ...trpc.team.assignees.queryOptions(), enabled: open });
  const update = useMutation(trpc.cases.update.mutationOptions({ meta: { quiet: true } }));
  const [assigneeId, setAssigneeId] = useState(c.assignee?.id ?? "");
  const [dueDate, setDueDate] = useState(c.dueDate ?? "");
  const [notes, setNotes] = useState(c.notes ?? "");

  return (
    <FormDialog
      open={open}
      onClose={() => {
        update.reset();
        onClose();
      }}
      title={`Edit ${c.number}`}
      submitLabel="Save"
      pending={update.isPending}
      error={update.error ? errorMessage(update.error) : null}
      onSubmit={async () => {
        const saved = await update
          .mutateAsync({
            case: c.number,
            assigneeId: assigneeId || null,
            dueDate: dueDate || null,
            notes: nullable(notes),
          })
          .catch(() => null);
        if (saved) {
          toast.success(`${c.number} saved`);
          onClose();
        }
      }}
    >
      <FieldRow>
        <SelectField
          label="Assigned to"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          options={[
            { value: "", label: "Nobody yet" },
            ...(assignees.data?.items ?? []).map((a) => ({
              value: a.id,
              label: `${a.name} (${a.role})`,
            })),
          ]}
        />
        <TextField
          label="Due at immigration"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </FieldRow>
      <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormDialog>
  );
}

const OUTCOMES = [
  {
    value: "APPROVED",
    label: "Approved",
    description: "Immigration granted it. The case is done.",
  },
  {
    value: "REJECTED",
    label: "Rejected",
    description: "Immigration refused it. The case is done.",
  },
  {
    value: "MORE_DOCUMENTS",
    label: "More documents needed",
    description: "Back to collecting. Say what they asked for.",
  },
] as const;

function OutcomeDialog({
  c,
  open,
  onClose,
}: {
  c: CaseDetail;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const close = useMutation(trpc.cases.close.mutationOptions({ meta: { quiet: true } }));
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"]>("APPROVED");
  const [note, setNote] = useState("");

  return (
    <FormDialog
      open={open}
      onClose={() => {
        close.reset();
        onClose();
      }}
      title="Log the outcome"
      description={`What did Chiang Mai Immigration decide on ${c.number}?`}
      submitLabel="Save outcome"
      pending={close.isPending}
      error={close.error ? errorMessage(close.error) : null}
      onSubmit={async () => {
        const saved = await close
          .mutateAsync({ case: c.number, outcome, ...(note.trim() ? { note: note.trim() } : {}) })
          .catch(() => null);
        if (saved) {
          toast.success(
            outcome === "MORE_DOCUMENTS"
              ? `${c.number} is back in collecting`
              : `${c.number} closed: ${outcome.toLowerCase()}`,
          );
          onClose();
        }
      }}
    >
      <RadioCards legend="Outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} />
      <TextAreaField
        label={outcome === "MORE_DOCUMENTS" ? "What did they ask for?" : "Note (optional)"}
        required={outcome === "MORE_DOCUMENTS"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </FormDialog>
  );
}

function ChangeStageDialog({
  c,
  open,
  onClose,
}: {
  c: CaseDetail;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const move = useMutation(trpc.cases.moveStage.mutationOptions({ meta: { quiet: true } }));
  const cancel = useMutation(trpc.cases.close.mutationOptions({ meta: { quiet: true } }));
  const [target, setTarget] = useState<string>(c.stage);
  const [note, setNote] = useState("");
  const cancelling = target === "CANCELLED";
  const error = move.error ?? cancel.error;

  return (
    <FormDialog
      open={open}
      onClose={() => {
        move.reset();
        cancel.reset();
        onClose();
      }}
      title={`Change the stage of ${c.number}`}
      description="Moving forward checks the checklist. Moving back is always allowed."
      submitLabel={cancelling ? "Cancel the case" : "Move"}
      submitVariant={cancelling ? "danger" : "primary"}
      pending={move.isPending || cancel.isPending}
      error={error ? errorMessage(error) : null}
      onSubmit={async () => {
        const trimmed = note.trim();
        const done = cancelling
          ? await cancel
              .mutateAsync({ case: c.number, outcome: "WITHDRAWN", note: trimmed })
              .catch(() => null)
          : await move
              .mutateAsync({
                case: c.number,
                stage: target as OpenStage,
                ...(trimmed ? { note: trimmed } : {}),
              })
              .catch(() => null);
        if (done) {
          toast.success(
            cancelling ? `${c.number} cancelled` : `${c.number} moved to ${stage(target).label}`,
          );
          onClose();
        }
      }}
    >
      <SelectField
        label="Stage"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        options={[
          ...OPEN_STAGES.map((s) => ({
            value: s.key,
            label: s.key === c.stage ? `${s.label} (now)` : s.label,
          })),
          { value: "CANCELLED", label: "Cancelled: the client withdrew" },
        ]}
      />
      <TextAreaField
        label={cancelling ? "Why is it cancelled?" : "Note (optional)"}
        required={cancelling}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        hint={cancelling ? "A cancelled case cannot be reopened." : undefined}
      />
    </FormDialog>
  );
}

// ---- checklist -------------------------------------------------------------------

/** Updates a checklist item, showing the change at once and undoing it if the server refuses. */
function useItemUpdate(c: CaseDetail) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const key = trpc.cases.get.queryKey({ case: c.number });
  return useMutation(
    trpc.cases.updateItem.mutationOptions({
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: key });
        const previous = queryClient.getQueryData(key);
        queryClient.setQueryData(key, (old) =>
          old
            ? {
                ...old,
                items: old.items.map((i) =>
                  i.id === vars.itemId
                    ? {
                        ...i,
                        status: vars.status ?? i.status,
                        note: vars.note === undefined ? i.note : vars.note,
                      }
                    : i,
                ),
              }
            : old,
        );
        return { previous };
      },
      onError: (_error, _vars, context) => {
        if (context?.previous) queryClient.setQueryData(key, context.previous);
      },
    }),
  );
}

function QuickUpload({ c, item }: { c: CaseDetail; item: Item }) {
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy } = useDocumentUpload({
    clientId: c.client.id,
    case: c.number,
    caseItemId: item.id,
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      <Button
        variant="soft"
        icon="upload"
        pending={busy}
        aria-label={`Upload ${item.label}`}
        onClick={() => input.current?.click()}
      >
        Upload
      </Button>
    </>
  );
}

function ChecklistRow({
  c,
  item,
  editable,
  onOpen,
}: {
  c: CaseDetail;
  item: Item;
  editable: boolean;
  onOpen: () => void;
}) {
  const { can, human } = useCan();
  const update = useItemUpdate(c);
  const status = ITEM_STATUS[item.status] ?? { label: item.status, tone: "mute" as const };
  const canUpload = can("documents", "edit") && c.client.consentGiven;

  return (
    <li
      className={`flex flex-wrap items-start gap-3 rounded-2xl px-2.5 py-2.5 ${item.status === "FLAGGED" ? "bg-[#FFF5F5]" : ""}`}
    >
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${TONE[status.tone]}`}
      >
        <Icon
          name={item.status === "FLAGGED" ? "alert" : item.status === "MISSING" ? "clock" : "check"}
          size={14}
          strokeWidth={2.6}
        />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{item.label}</span>
          {!item.required && <Chip>Optional</Chip>}
        </div>
        <div
          className={`mt-0.5 text-sm ${item.status === "FLAGGED" ? "text-[#A32A2A]" : "text-muted"}`}
        >
          {item.note ?? status.label}
          {item.flaggedBy === "ASSISTANT" &&
            item.status === "FLAGGED" &&
            " · flagged by the assistant"}
          {item.documentIds.length > 0 &&
            ` · ${item.documentIds.length} document${item.documentIds.length > 1 ? "s" : ""}`}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {editable && item.status === "MISSING" && canUpload && <QuickUpload c={c} item={item} />}
        {editable && item.status === "RECEIVED" && human && (
          <Button
            variant="soft"
            icon="check"
            onClick={() => update.mutate({ case: c.number, itemId: item.id, status: "VERIFIED" })}
          >
            Verify
          </Button>
        )}
        {!(editable && ["MISSING", "RECEIVED"].includes(item.status)) && (
          <Chip tone={status.tone}>{status.label}</Chip>
        )}
        {editable && (
          <IconButton icon="more" label={`Update ${item.label}`} variant="ghost" onClick={onOpen} />
        )}
      </div>
    </li>
  );
}

const STATUS_CHOICES: ReadonlyArray<{
  value: ItemStatus;
  label: string;
  description: string;
  humanOnly?: boolean;
}> = [
  { value: "MISSING", label: "Missing", description: "Not received yet." },
  { value: "RECEIVED", label: "Received", description: "In hand, not checked yet." },
  {
    value: "VERIFIED",
    label: "Verified",
    description: "Checked by a person.",
    humanOnly: true,
  },
  { value: "FLAGGED", label: "Flagged", description: "Something is wrong. Say what." },
  {
    value: "WAIVED",
    label: "Waived",
    description: "Not needed for this client. Say why.",
    humanOnly: true,
  },
];

function ItemDialog({
  c,
  itemId,
  onClose,
}: {
  c: CaseDetail;
  itemId: string;
  onClose: () => void;
}) {
  const { can, human } = useCan();
  const update = useItemUpdate(c);
  const item = c.items.find((i) => i.id === itemId);
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? "MISSING");
  const [note, setNote] = useState(item?.note ?? "");
  const { upload, busy } = useDocumentUpload({
    clientId: c.client.id,
    case: c.number,
    caseItemId: itemId,
  });
  if (!item) return null;

  const needsNote = status === "FLAGGED" || status === "WAIVED";
  const docs = c.documents.filter((d) => d.caseItemId === item.id);

  return (
    <FormDialog
      open
      wide
      onClose={onClose}
      title={item.label}
      description={`${c.number} · ${item.required ? "Required" : "Optional"}`}
      submitLabel="Save"
      pending={update.isPending}
      onSubmit={() => {
        update.mutate(
          {
            case: c.number,
            itemId: item.id,
            status,
            note: note.trim() ? note.trim() : needsNote ? undefined : null,
          },
          { onSuccess: onClose },
        );
      }}
    >
      <RadioCards
        legend="Status"
        value={status}
        onChange={(next) => {
          // A flag or waiver reason no longer applies once the status moves on.
          if ((item.status === "FLAGGED" || item.status === "WAIVED") && next !== item.status) {
            setNote("");
          }
          setStatus(next);
        }}
        options={STATUS_CHOICES.map((o) => ({ ...o, disabled: o.humanOnly && !human }))}
      />
      <TextAreaField
        label={
          status === "FLAGGED"
            ? "What is wrong?"
            : status === "WAIVED"
              ? "Why is it not needed?"
              : "Note (optional)"
        }
        required={needsNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          status === "FLAGGED" ? "e.g. Photo background is grey, the office wants white" : ""
        }
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-extrabold">Documents for this item</span>
        <DocumentList documents={docs} empty="Nothing uploaded for this item yet." />
        {can("documents", "edit") &&
          (c.client.consentGiven ? (
            <FileDrop
              busy={busy}
              title="Add a document"
              hint="A missing item becomes received."
              onFiles={(files) => void upload(files)}
            />
          ) : (
            <ConsentHint c={c} />
          ))}
      </div>
    </FormDialog>
  );
}

function ConsentHint({ c }: { c: CaseDetail }) {
  return (
    <p className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
      {c.client.fullName} has not accepted the privacy notice yet. Record their consent on the{" "}
      <Link to="/clients/$clientId" params={{ clientId: c.client.id }} className="underline">
        client page
      </Link>{" "}
      before uploading documents.
    </p>
  );
}

function Checklist({ c }: { c: CaseDetail }) {
  const { can } = useCan();
  const [openItem, setOpenItem] = useState<string | null>(null);
  const editable = isOpen(c) && can("cases", "edit");
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
        {c.items.map((item) => (
          <ChecklistRow
            key={item.id}
            c={c}
            item={item}
            editable={editable}
            onOpen={() => setOpenItem(item.id)}
          />
        ))}
      </ul>
      {openItem && <ItemDialog c={c} itemId={openItem} onClose={() => setOpenItem(null)} />}
    </Card>
  );
}

// ---- side cards ------------------------------------------------------------------

function Documents({ c }: { c: CaseDetail }) {
  const { can } = useCan();
  const { upload, busy } = useDocumentUpload({ clientId: c.client.id, case: c.number });
  const labels = Object.fromEntries(
    c.documents.flatMap((d) => {
      const item = c.items.find((i) => i.id === d.caseItemId);
      return item ? [[d.id, item.label]] : [];
    }),
  );
  return (
    <Card>
      <CardTitle icon={{ name: "upload" }}>Documents</CardTitle>
      <DocumentList documents={c.documents} empty="No documents yet." labels={labels} />
      {isOpen(c) && can("documents", "edit") && (
        <div className="mt-3">
          {c.client.consentGiven ? (
            <FileDrop
              busy={busy}
              title="Add documents to this case"
              hint="PDF, photos or DOCX, up to 20 MB each. Use a checklist item's menu to file one under it."
              onFiles={(files) => void upload(files)}
            />
          ) : (
            <ConsentHint c={c} />
          )}
        </div>
      )}
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

function StageCard({ c }: { c: CaseDetail }) {
  const { can } = useCan();
  const [changing, setChanging] = useState(false);
  return (
    <Card>
      <Stepper current={c.stage} />
      {isOpen(c) && can("cases", "edit") && (
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" icon="sliders" onClick={() => setChanging(true)}>
            Change stage
          </Button>
          {changing && <ChangeStageDialog c={c} open onClose={() => setChanging(false)} />}
        </div>
      )}
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
            <StageCard c={c} />
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
