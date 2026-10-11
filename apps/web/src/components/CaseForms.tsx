import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCan } from "../lib/can";
import { timeAgo } from "../lib/format";
import { downloadFrom } from "../lib/open";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";
import { Button, Dialog, IconButton, INPUT } from "./controls";
import { boxStyle, useStableUrl } from "./FormFieldsDialog";
import { Icon } from "./Icon";
import { PdfPages } from "./PdfPages";
import { TemplateFileList, useTemplateFileLink } from "./TemplateFileList";
import { Card, CardTitle, Chip } from "./ui";

type CaseDetail = Outputs["cases"]["get"];
type CaseFormSummary = Outputs["forms"]["list"]["forms"][number];
type CaseForm = Outputs["forms"]["get"];
type FormField = CaseForm["fields"][number];
type Value = string | boolean | null;

const isOpen = (c: CaseDetail) => c.stage !== "DONE" && c.stage !== "CANCELLED";

function formState(f: CaseFormSummary): { label: string; tone: "ok" | "warn" | "mute" | "info" } {
  if (!f.fillable) return { label: "Not set up", tone: "mute" };
  if (f.status === "CHECKED") return { label: "Checked", tone: "ok" };
  if (f.status === "DRAFT") return { label: "To check", tone: "warn" };
  return { label: "Not filled", tone: "mute" };
}

/**
 * The case's forms and letters: EzVisa fills them from the client's record and documents,
 * a person reviews and checks each one. Other template files are listed below.
 */
export function CaseForms({ c }: { c: CaseDetail }) {
  const trpc = useTRPC();
  const { can } = useCan();
  const query = useQuery({
    ...trpc.forms.list.queryOptions({ case: c.number }),
    refetchInterval: (q) => (q.state.data?.preparing ? 3000 : false),
  });
  const prepare = useMutation(trpc.forms.prepare.mutationOptions());
  const queryClient = useQueryClient();
  const blank = useTemplateFileLink(c.number);
  const [open, setOpen] = useState<CaseFormSummary | null>(null);

  // Toast once the background fill ends.
  const preparing = query.data?.preparing ?? false;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !preparing) toast.success("The forms are filled. Check each one.");
    was.current = preparing;
  }, [preparing]);

  /** The filled PDF, fetched with a fresh link. */
  const downloadFilled = (f: CaseFormSummary) =>
    downloadFrom(async () => {
      const form = await queryClient.fetchQuery(
        trpc.forms.get.queryOptions({ case: c.number, fileId: f.fileId }),
      );
      return form.downloadUrl;
    });

  const forms = query.data?.forms ?? [];
  const fillableIds = new Set(forms.map((f) => f.fileId));
  const others = c.forms.filter((f) => !fillableIds.has(f.id));
  if (c.forms.length === 0) return null;
  const canFill = isOpen(c) && can("cases", "edit") && forms.some((f) => f.fillable);

  return (
    <Card>
      <CardTitle
        icon={{ name: "file" }}
        sub="EzVisa fills them from the client's record and documents once everything asked is in. A person checks each one."
        aside={
          canFill && (
            <Button
              variant="soft"
              icon="sparkle"
              pending={prepare.isPending || preparing}
              onClick={() =>
                prepare.mutate(
                  { case: c.number },
                  {
                    onSuccess: () =>
                      toast.success("Filling the forms. This takes a minute or two."),
                  },
                )
              }
            >
              {preparing ? "Filling…" : forms.some((f) => f.status) ? "Fill again" : "Fill forms"}
            </Button>
          )
        }
      >
        Forms
      </CardTitle>
      {forms.length > 0 && (
        <ul className="divide-y divide-line">
          {forms.map((f) => {
            const state = formState(f);
            return (
              <li key={f.fileId} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE.accent}`}
                >
                  <Icon name="file" />
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate text-sm font-extrabold">{f.name}</div>
                  <div className="text-xs text-muted">
                    {!f.fillable
                      ? "Set it up on the template to fill it."
                      : !f.status
                        ? `${f.fields} fields`
                        : `${f.filled} of ${f.fields} filled${f.toFill ? `, ${f.toFill} for the team` : ""}${
                            f.checkedAt ? ` · checked ${timeAgo(f.checkedAt)}` : ""
                          }`}
                  </div>
                </div>
                <Chip tone={state.tone}>{state.label}</Chip>
                <span className="flex items-center gap-1">
                  <IconButton
                    icon="download"
                    label={
                      f.status ? `Download the filled ${f.name}` : `Download the blank ${f.name}`
                    }
                    variant="ghost"
                    onClick={() => (f.status ? void downloadFilled(f) : blank.download(f.fileId))}
                  />
                  {f.fillable ? (
                    <Button variant="soft" onClick={() => setOpen(f)}>
                      {f.status === "DRAFT" ? "Review" : "Open"}
                    </Button>
                  ) : (
                    <Button
                      variant="soft"
                      pending={blank.opening(f.fileId)}
                      onClick={() => blank.open(f.fileId)}
                    >
                      Open
                      <Icon name="external" size={15} />
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <div className={forms.length > 0 ? "mt-3 border-t border-line pt-1" : ""}>
          <TemplateFileList files={others} empty="" caseNumber={c.number} />
        </div>
      )}
      {open && (
        <CaseFormDialog c={c} fileId={open.fileId} name={open.name} onClose={() => setOpen(null)} />
      )}
    </Card>
  );
}

function whoFilled(f: FormField): string {
  if (f.by === "person") return `Entered by ${f.from ?? "a person"}`;
  if (f.by === "agent") return `Claude${f.from ? `, from ${f.from}` : ""}`;
  if (f.by === "source") return `From the record: ${f.from ?? ""}`.trim();
  if (f.source === null) return "For the team";
  if (f.source === "ai") return "Claude found nothing";
  return "Not on the record";
}

/** One filled form: the PDF beside its fields, to correct, save and check. */
function CaseFormDialog({
  c,
  fileId,
  name,
  onClose,
}: {
  c: CaseDetail;
  fileId: string;
  name: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { can, human } = useCan();
  const editable = isOpen(c) && can("cases", "edit");
  const query = useQuery({
    ...trpc.forms.get.queryOptions({ case: c.number, fileId }),
    refetchOnWindowFocus: false,
  });
  const save = useMutation(trpc.forms.update.mutationOptions({ meta: { quiet: true } }));
  const check = useMutation(trpc.forms.check.mutationOptions());
  const form = query.data;
  const url = useStableUrl(form?.pdfUrl, form?.version);
  const [edits, setEdits] = useState<Record<string, Value>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = Object.keys(edits).length > 0;

  const current = (f: FormField): Value => (f.name in edits ? (edits[f.name] ?? null) : f.value);
  const set = (f: FormField, value: Value) =>
    setEdits((all) => {
      const next = { ...all };
      if (value === f.value || (value === "" && f.value === null)) delete next[f.name];
      else next[f.name] = value;
      return next;
    });

  function submit() {
    setError(null);
    save.mutate(
      { case: c.number, fileId, values: edits },
      {
        onSuccess: () => {
          setEdits({});
          toast.success(`${name} saved`);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  const empty = form?.fields.filter((f) => current(f) === null || current(f) === "").length ?? 0;

  return (
    <Dialog
      open
      full
      onClose={() => {
        if (!dirty || window.confirm("Leave without saving your changes?")) onClose();
      }}
      title={`${name}, ${c.number}`}
      description={`${c.client.fullName}. Check every value against the documents before marking the form checked.`}
    >
      {!form ? (
        <div aria-busy="true" className="h-96 animate-pulse rounded-3xl bg-bg" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {form.status === "CHECKED" ? (
              <Chip tone="ok" icon="check">
                Checked{form.checkedBy ? ` by ${form.checkedBy}` : ""}
              </Chip>
            ) : form.status === "DRAFT" ? (
              <Chip tone="warn">To check</Chip>
            ) : (
              <Chip>Not filled yet</Chip>
            )}
            <span className="text-sm text-muted">
              {empty === 0
                ? "Every field has a value."
                : `${empty} empty field${empty > 1 ? "s" : ""}.`}
            </span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              icon="download"
              onClick={() => void downloadFrom(async () => form.downloadUrl)}
            >
              Download
            </Button>
            {editable && (
              <Button variant="outline" pending={save.isPending} disabled={!dirty} onClick={submit}>
                Save
              </Button>
            )}
            {editable && human && form.status === "DRAFT" && (
              <Button
                icon="check"
                pending={check.isPending}
                disabled={dirty}
                title={dirty ? "Save your changes first" : undefined}
                onClick={() =>
                  check.mutate(
                    { case: c.number, fileId },
                    { onSuccess: () => toast.success(`${name} checked`) },
                  )
                }
              >
                Mark checked
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.bad}`}>
              {error}
            </p>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-0">
              {url && (
                <PdfPages
                  url={url}
                  overlay={(page, scale, size) =>
                    form.fields
                      .filter((f) => f.page === page && f.name === selected)
                      .map((f) => (
                        <div
                          key={f.name}
                          className="pointer-events-none absolute rounded-[3px] border-2 border-ink bg-accent/20"
                          style={boxStyle(f.rect, scale, size)}
                        />
                      ))
                  }
                />
              )}
              {dirty && (
                <p className="mt-2 text-xs text-muted">The PDF shows your changes once saved.</p>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {form.fields.map((f) => (
                <FieldRow
                  key={f.name}
                  field={f}
                  value={current(f)}
                  edited={f.name in edits}
                  editable={editable}
                  selected={selected === f.name}
                  onFocus={() => setSelected(f.name)}
                  onChange={(v) => set(f, v)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function FieldRow({
  field,
  value,
  edited,
  editable,
  selected,
  onFocus,
  onChange,
}: {
  field: FormField;
  value: Value;
  edited: boolean;
  editable: boolean;
  selected: boolean;
  onFocus: () => void;
  onChange: (value: Value) => void;
}) {
  const id = `field-${field.name}`;
  const missing = value === null || value === "";
  const printed =
    !edited && typeof field.printed === "string" && field.printed !== field.value
      ? field.printed
      : null;
  return (
    <li
      className={`rounded-2xl border p-3 ${
        selected
          ? "border-ink"
          : missing && field.source === null
            ? "border-[#F2C46D]"
            : "border-line"
      }`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-extrabold">
          {field.label}
        </label>
        <span className="text-right text-xs text-muted">
          {edited ? "Changed, not saved" : whoFilled(field)}
        </span>
      </div>
      {field.type === "checkbox" ? (
        <input
          id={id}
          type="checkbox"
          checked={value === true || value === "true"}
          disabled={!editable}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.checked)}
          className="size-5 cursor-pointer accent-[var(--ezv-ink)]"
        />
      ) : field.options?.length ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value || null)}
          className={`h-10 cursor-pointer ${INPUT}`}
        >
          <option value="">(empty)</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.multiline ? (
        <textarea
          id={id}
          rows={3}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          className={`py-2 ${INPUT}`}
        />
      ) : (
        <input
          id={id}
          value={typeof value === "string" ? value : ""}
          disabled={!editable}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          className={`h-10 ${INPUT}`}
        />
      )}
      {(printed || field.hint) && (
        <p className="mt-1 text-xs text-muted">
          {printed && <>Printed as {printed}. </>}
          {field.hint}
        </p>
      )}
    </li>
  );
}
