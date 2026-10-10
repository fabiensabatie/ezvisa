import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  CheckboxField,
  FieldRow,
  FormDialog,
  IconButton,
  INPUT,
  nullable,
  optional,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/controls";
import { FileDrop } from "../components/DocumentList";
import { Icon } from "../components/Icon";
import { Card, CardTitle, Chip, Empty, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { fileSize, formatInstant, plural } from "../lib/format";
import { toast } from "../lib/toast";
import { DEADLINE_LABEL, TONE } from "../lib/tones";
import { fileProblem, mimeOf, putFile } from "../lib/upload";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Template = Outputs["templates"]["get"];
type TemplateItem = Template["selected"]["items"][number];
type ItemKind = TemplateItem["kind"];
type FileKind = Template["selected"]["files"][number]["kind"];
type DeadlineKind = "STAY_ENDS" | "REPORT_DUE";

const ITEM_KINDS: ReadonlyArray<{ value: ItemKind; label: string }> = [
  { value: "DOCUMENT", label: "Document from the client" },
  { value: "FORM", label: "Form we fill in" },
  { value: "PAYMENT", label: "Payment or fee" },
  { value: "OTHER", label: "Other" },
];
const FILE_KINDS: ReadonlyArray<{ value: FileKind; label: string }> = [
  { value: "PDF_FORM", label: "Form to fill in" },
  { value: "LETTER", label: "Letter template" },
  { value: "REFERENCE", label: "Reference" },
];
const DEADLINE_OPTIONS = [
  { value: "", label: "None" },
  { value: "STAY_ENDS", label: DEADLINE_LABEL.STAY_ENDS ?? "Permission to stay ends" },
  { value: "REPORT_DUE", label: DEADLINE_LABEL.REPORT_DUE ?? "90-day report due" },
];

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---- list ------------------------------------------------------------------------

function NewTemplateDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const create = useMutation(trpc.templates.create.mutationOptions({ meta: { quiet: true } }));
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [office, setOffice] = useState("Chiang Mai Immigration");
  const [deadlineKind, setDeadlineKind] = useState("");
  const [description, setDescription] = useState("");

  return (
    <FormDialog
      open
      onClose={onClose}
      title="New template"
      description="It starts as a draft. Add its checklist, then publish it to open cases with it."
      submitLabel="Create draft"
      pending={create.isPending}
      error={create.error ? errorMessage(create.error) : null}
      onSubmit={async () => {
        const created = await create
          .mutateAsync({
            slug: slugTouched ? slug : slugify(name),
            name: name.trim(),
            office: optional(office),
            description: optional(description),
            ...(deadlineKind ? { deadlineKind: deadlineKind as DeadlineKind } : {}),
          })
          .catch(() => null);
        if (!created) return;
        toast.success(`${created.name} created as a draft`);
        onClose();
        void navigate({ to: "/templates/$slug", params: { slug: created.slug } });
      }}
    >
      <TextField
        label="Name"
        required
        placeholder="e.g. Marriage visa extension"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Short id"
        hint="Used in links and by Claude. Lowercase words joined by hyphens."
        required
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        value={slugTouched ? slug : slugify(name)}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value);
        }}
      />
      <FieldRow>
        <TextField label="Office" value={office} onChange={(e) => setOffice(e.target.value)} />
        <SelectField
          label="Resolves the client deadline"
          options={DEADLINE_OPTIONS}
          value={deadlineKind}
          onChange={(e) => setDeadlineKind(e.target.value)}
        />
      </FieldRow>
      <TextAreaField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </FormDialog>
  );
}

export function TemplatesPage() {
  const trpc = useTRPC();
  const { can } = useCan();
  const list = useQuery(trpc.templates.list.queryOptions({ includeArchived: false }));
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="A template holds the checklist, forms and letters for one case type. Each new case copies the current version."
      >
        {can("templates", "edit") && (
          <Button variant="soft" icon="plus" onClick={() => setCreating(true)}>
            New template
          </Button>
        )}
      </PageHeader>
      <QueryView query={list} what="templates">
        {(data) =>
          data.items.length === 0 ? (
            <Empty>No templates yet. Create one, or ask Claude to with create_template.</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((t) => (
                <Link
                  key={t.id}
                  to="/templates/$slug"
                  params={{ slug: t.slug }}
                  className="flex flex-col gap-3.5 rounded-3xl border border-line bg-white p-5 shadow-card transition-transform hover:-translate-y-0.5"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`grid size-11 place-items-center rounded-2xl ${TONE.accent}`}>
                      <Icon name="file" size={22} />
                    </span>
                    <span className="flex gap-1.5">
                      {t.publishedVersion ? (
                        <Chip tone="ok">v{t.publishedVersion} live</Chip>
                      ) : (
                        <Chip tone="warn">Not published</Chip>
                      )}
                      {t.draftVersion && <Chip tone="accent">Draft v{t.draftVersion}</Chip>}
                    </span>
                  </span>
                  <span>
                    <span className="block font-display text-lg font-semibold">{t.name}</span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {t.description ?? t.office}
                    </span>
                  </span>
                  <span className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
                    <Chip tone="accent">{plural(t.itemCount ?? 0, "checklist item")}</Chip>
                    {t.deadlineKind && <Chip tone="info">{DEADLINE_LABEL[t.deadlineKind]}</Chip>}
                  </span>
                </Link>
              ))}
            </div>
          )
        }
      </QueryView>
      {creating && <NewTemplateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// ---- detail: dialogs -------------------------------------------------------------------

function DetailsDialog({ t, onClose }: { t: Template; onClose: () => void }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.templates.update.mutationOptions({ meta: { quiet: true } }));
  const [name, setName] = useState(t.name);
  const [office, setOffice] = useState(t.office);
  const [deadlineKind, setDeadlineKind] = useState<string>(t.deadlineKind ?? "");
  const [description, setDescription] = useState(t.description ?? "");

  return (
    <FormDialog
      open
      onClose={onClose}
      title="Template details"
      description="Name, office and description change straight away, for every version."
      submitLabel="Save"
      pending={update.isPending}
      error={update.error ? errorMessage(update.error) : null}
      onSubmit={async () => {
        const saved = await update
          .mutateAsync({
            template: t.slug,
            name: name.trim(),
            office: office.trim(),
            description: nullable(description),
            deadlineKind: deadlineKind ? (deadlineKind as DeadlineKind) : null,
          })
          .catch(() => null);
        if (saved) {
          toast.success("Details saved");
          onClose();
        }
      }}
    >
      <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
      <FieldRow>
        <TextField
          label="Office"
          required
          value={office}
          onChange={(e) => setOffice(e.target.value)}
        />
        <SelectField
          label="Resolves the client deadline"
          options={DEADLINE_OPTIONS}
          value={deadlineKind}
          onChange={(e) => setDeadlineKind(e.target.value)}
        />
      </FieldRow>
      <TextAreaField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </FormDialog>
  );
}

function ItemDialog({
  t,
  item,
  onClose,
}: {
  t: Template;
  /** Absent when adding a new item. */
  item?: TemplateItem;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const add = useMutation(trpc.templates.addItem.mutationOptions({ meta: { quiet: true } }));
  const update = useMutation(trpc.templates.updateItem.mutationOptions({ meta: { quiet: true } }));
  const mutation = item ? update : add;
  const [label, setLabel] = useState(item?.label ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? "DOCUMENT");
  const [required, setRequired] = useState(item?.required ?? true);
  const [formFileId, setFormFileId] = useState(item?.formFileId ?? "");

  return (
    <FormDialog
      open
      onClose={onClose}
      title={item ? "Edit checklist item" : "Add a checklist item"}
      description="Open cases keep their own copy. This changes cases opened after you publish."
      submitLabel={item ? "Save" : "Add item"}
      pending={mutation.isPending}
      error={mutation.error ? errorMessage(mutation.error) : null}
      onSubmit={async () => {
        const saved = item
          ? await update
              .mutateAsync({
                template: t.slug,
                itemId: item.id,
                label: label.trim(),
                description: nullable(description),
                kind,
                required,
                formFileId: formFileId || null,
              })
              .catch(() => null)
          : await add
              .mutateAsync({
                template: t.slug,
                label: label.trim(),
                description: optional(description),
                kind,
                required,
              })
              .catch(() => null);
        if (saved) onClose();
      }}
    >
      <TextField
        label="What the client provides"
        required
        placeholder="e.g. Bank letter confirming the balance"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <TextAreaField
        label="Details"
        hint="Shown to the team and to Claude, e.g. how recent it must be."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <FieldRow>
        <SelectField
          label="Kind"
          options={ITEM_KINDS}
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind)}
        />
        {item && (
          <SelectField
            label="Filled from form"
            options={[
              { value: "", label: "No form" },
              ...t.selected.files.map((f) => ({ value: f.id, label: f.name })),
            ]}
            value={formFileId}
            onChange={(e) => setFormFileId(e.target.value)}
          />
        )}
      </FieldRow>
      <CheckboxField
        label="Required"
        hint="A case moves to validation only once every required item is in."
        checked={required}
        onChange={setRequired}
      />
    </FormDialog>
  );
}

function AttachDialog({ t, file, onClose }: { t: Template; file: File; onClose: () => void }) {
  const trpc = useTRPC();
  const create = useMutation(
    trpc.templates.createFileUpload.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );
  const confirm = useMutation(
    trpc.templates.confirmFileUpload.mutationOptions({ meta: { quiet: true } }),
  );
  const [name, setName] = useState(file.name.replace(/\.[^.]+$/, ""));
  const [kind, setKind] = useState<FileKind>("PDF_FORM");
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      open
      onClose={onClose}
      title="Attach a file"
      description={`${file.name} · ${fileSize(file.size)}`}
      submitLabel="Attach"
      pending={busy}
      error={error}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        try {
          const mimeType = mimeOf(file);
          const link = await create.mutateAsync({
            template: t.slug,
            filename: file.name,
            mimeType,
            sizeBytes: file.size,
          });
          await putFile(link, file);
          await confirm.mutateAsync({
            template: t.slug,
            uploadKey: link.uploadKey,
            name: name.trim(),
            kind,
            mimeType,
            ...(itemId ? { itemId } : {}),
          });
          toast.success(`${name.trim()} attached`);
          onClose();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        label="Name"
        required
        hint='As the team calls it, e.g. "TM.7 application"'
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FieldRow>
        <SelectField
          label="Kind"
          options={FILE_KINDS}
          value={kind}
          onChange={(e) => setKind(e.target.value as FileKind)}
        />
        <SelectField
          label="Form for checklist item"
          options={[
            { value: "", label: "None" },
            ...t.selected.items.map((i) => ({ value: i.id, label: `${i.position}. ${i.label}` })),
          ]}
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
        />
      </FieldRow>
    </FormDialog>
  );
}

function PublishDialog({
  t,
  onClose,
  onPublished,
}: {
  t: Template;
  onClose: () => void;
  onPublished: () => void;
}) {
  const trpc = useTRPC();
  const publish = useMutation(trpc.templates.publish.mutationOptions({ meta: { quiet: true } }));
  const [notes, setNotes] = useState(t.selected.notes ?? "");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Publish version ${t.selected.version}`}
      description="New cases will use it. Open cases keep the version they started with."
      submitLabel="Publish"
      pending={publish.isPending}
      error={publish.error ? errorMessage(publish.error) : null}
      onSubmit={async () => {
        const done = await publish
          .mutateAsync({ template: t.slug, ...(notes.trim() ? { notes: notes.trim() } : {}) })
          .catch(() => null);
        if (done) {
          toast.success(`${t.name} v${t.selected.version} is live`);
          onClose();
          onPublished();
        }
      }}
    >
      <TextAreaField
        label="What changed"
        placeholder="e.g. Bank letter must be under 7 days old"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </FormDialog>
  );
}

// ---- detail: editable sections -------------------------------------------------------

function Checklist({ t, editing }: { t: Template; editing: boolean }) {
  const trpc = useTRPC();
  const reorder = useMutation(trpc.templates.reorderItems.mutationOptions());
  const remove = useMutation(trpc.templates.removeItem.mutationOptions());
  const [dialog, setDialog] = useState<{ item?: TemplateItem } | null>(null);
  const items = t.selected.items;

  function move(index: number, by: -1 | 1) {
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + by, 0, moved);
    reorder.mutate({ template: t.slug, itemIds: ids });
  }

  return (
    <Card>
      <CardTitle
        sub={
          t.selected.publishedAt
            ? `Published ${formatInstant(t.selected.publishedAt)}${t.selected.notes ? ` · ${t.selected.notes}` : ""}`
            : (t.selected.notes ?? "Copied into every new case once published")
        }
        aside={<span className="text-sm text-muted">{plural(items.length, "item")}</span>}
      >
        Checklist
      </CardTitle>
      {items.length === 0 && <Empty>No items yet. Add what the client must provide.</Empty>}
      <ol className="divide-y divide-line">
        {items.map((item, index) => (
          <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${TONE.accent}`}
            >
              {item.position}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <div className="font-bold">{item.label}</div>
              {item.description && (
                <div className="mt-0.5 text-sm text-muted">{item.description}</div>
              )}
              {item.rules !== null && (
                <div className="mt-1 font-mono text-xs text-muted">
                  {JSON.stringify(item.rules)}
                </div>
              )}
            </div>
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {item.kind !== "DOCUMENT" && <Chip tone="info">{item.kind.toLowerCase()}</Chip>}
              {!item.required && <Chip>Optional</Chip>}
              {item.formFileId && <Chip tone="accent">Pre-filled form</Chip>}
              {editing && (
                <>
                  <IconButton
                    icon="chevronUp"
                    label={`Move ${item.label} up`}
                    variant="ghost"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  />
                  <IconButton
                    icon="chevronDown"
                    label={`Move ${item.label} down`}
                    variant="ghost"
                    disabled={index === items.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  />
                  <IconButton
                    icon="edit"
                    label={`Edit ${item.label}`}
                    variant="ghost"
                    onClick={() => setDialog({ item })}
                  />
                  <IconButton
                    icon="trash"
                    label={`Remove ${item.label}`}
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ template: t.slug, itemId: item.id })}
                  />
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      {editing && (
        <Button variant="soft" icon="plus" className="mt-3" onClick={() => setDialog({})}>
          Add item
        </Button>
      )}
      {dialog && <ItemDialog t={t} item={dialog.item} onClose={() => setDialog(null)} />}
    </Card>
  );
}

function Files({ t, editing }: { t: Template; editing: boolean }) {
  const trpc = useTRPC();
  const remove = useMutation(trpc.templates.removeFile.mutationOptions());
  const [picked, setPicked] = useState<File | null>(null);

  return (
    <Card>
      <CardTitle>Forms and files</CardTitle>
      {t.selected.files.length === 0 ? (
        <Empty>No forms attached.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {t.selected.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-3">
              <span className={`grid size-10 place-items-center rounded-xl ${TONE.accent}`}>
                <Icon name="file" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-extrabold">{f.name}</div>
                <div className="text-xs text-muted">{fileSize(f.sizeBytes)}</div>
              </div>
              <Chip tone="accent">
                {FILE_KINDS.find((k) => k.value === f.kind)?.label ?? f.kind}
              </Chip>
              {editing && (
                <IconButton
                  icon="trash"
                  label={`Remove ${f.name}`}
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ template: t.slug, fileId: f.id })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mt-3">
          <FileDrop
            busy={false}
            multiple={false}
            title="Drop a PDF or DOCX"
            hint="Forms the team fills in for this case type, up to 20 MB."
            onFiles={([file]) => {
              if (!file) return;
              const problem = fileProblem(file);
              if (problem) toast.error(problem);
              else setPicked(file);
            }}
          />
        </div>
      )}
      {picked && <AttachDialog t={t} file={picked} onClose={() => setPicked(null)} />}
    </Card>
  );
}

function KnownFailures({ t, editing }: { t: Template; editing: boolean }) {
  const trpc = useTRPC();
  const update = useMutation(trpc.templates.update.mutationOptions());
  const [draft, setDraft] = useState("");
  const failures = t.selected.knownFailures;
  const save = (knownFailures: string[], then?: () => void) =>
    update.mutate({ template: t.slug, knownFailures }, { onSuccess: then });

  return (
    <Card>
      <CardTitle
        icon={{ name: "alert", tone: "warn" }}
        sub="From Namtarn's notes and past rejections. The assistant checks every case against them."
      >
        Known failures
      </CardTitle>
      {failures.length === 0 ? (
        <Empty>None recorded.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {failures.map((f) => (
            <li
              key={f}
              className={`flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-bold ${TONE.warn}`}
            >
              <span className="flex-1 py-1">{f}</span>
              {editing && (
                <button
                  type="button"
                  aria-label={`Remove "${f}"`}
                  title="Remove"
                  disabled={update.isPending}
                  onClick={() => save(failures.filter((x) => x !== f))}
                  className="-mr-1.5 grid size-9 cursor-pointer place-items-center rounded-lg hover:bg-white/60"
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text || failures.includes(text)) return;
            save([...failures, text], () => setDraft(""));
          }}
        >
          <label htmlFor="new-failure" className="sr-only">
            New known failure
          </label>
          <input
            id="new-failure"
            value={draft}
            maxLength={300}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Lease not signed by the owner"
            className={`h-11 flex-1 ${INPUT}`}
          />
          <Button type="submit" variant="soft" icon="plus" pending={update.isPending}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---- detail page -----------------------------------------------------------------------

function DraftBanner({ t, onDone }: { t: Template; onDone: () => void }) {
  const trpc = useTRPC();
  const discard = useMutation(trpc.templates.discardDraft.mutationOptions());
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const firstVersion = t.versions.length === 1;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-dashed border-ink/40 bg-soft px-5 py-4">
      <Icon name="edit" className="text-ink" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="font-extrabold">Draft version {t.selected.version}</div>
        <div className="text-sm text-text-soft">
          {firstVersion
            ? "Publish it to open cases with this template."
            : `New cases keep using v${t.publishedVersion} until you publish this draft.`}
        </div>
      </div>
      {!firstVersion && (
        <Button variant="outline" onClick={() => setDiscarding(true)}>
          Discard draft
        </Button>
      )}
      <Button icon="check" onClick={() => setPublishing(true)}>
        Publish v{t.selected.version}
      </Button>
      {publishing && (
        <PublishDialog t={t} onClose={() => setPublishing(false)} onPublished={onDone} />
      )}
      <FormDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Discard this draft?"
        description={`Every change since v${t.publishedVersion} is lost. The published version stays as it is.`}
        submitLabel="Discard draft"
        submitVariant="danger"
        pending={discard.isPending}
        onSubmit={async () => {
          const done = await discard.mutateAsync({ template: t.slug }).catch(() => null);
          setDiscarding(false);
          if (done) onDone();
        }}
      />
    </div>
  );
}

export function TemplateDetailPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { can } = useCan();
  const canEdit = can("templates", "edit");
  const [picked, setPicked] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [details, setDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archive = useMutation(trpc.templates.archive.mutationOptions());

  // The draft when there is one, so editing is where people land.
  const summary = useQuery(trpc.templates.get.queryOptions({ template: slug }));
  const hasDraft = summary.data?.versions.some((v) => v.status === "DRAFT") ?? false;
  const version = picked ?? (hasDraft ? ("draft" as const) : ("published" as const));
  const query = useQuery({
    ...trpc.templates.get.queryOptions({ template: slug, version }),
    enabled: summary.isSuccess,
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <Link
        to="/templates"
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 font-extrabold text-ink"
      >
        <Icon name="arrowLeft" />
        All templates
      </Link>
      <QueryView query={summary.error ? summary : query} what="This template">
        {(t) => {
          const isDraft = t.selected.status === "DRAFT";
          // A draft opens ready to edit. The live version needs "Edit template" first; the
          // server then copies it into a new draft on the first change.
          const editing = canEdit && !t.archived && (isDraft || (editMode && picked === null));
          return (
            <div className="flex flex-col gap-5">
              <Card className="flex flex-wrap items-center gap-5">
                <span
                  className={`grid size-14 shrink-0 place-items-center rounded-2xl ${TONE.accent}`}
                >
                  <Icon name="file" size={28} strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display text-2xl font-semibold">{t.name}</h1>
                    {t.archived && <Chip>Archived</Chip>}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {t.office} ·{" "}
                    {t.deadlineKind ? DEADLINE_LABEL[t.deadlineKind] : "No client deadline"}
                    {t.description ? ` · ${t.description}` : ""}
                  </p>
                </div>
                <fieldset className="flex flex-wrap gap-1.5">
                  <legend className="sr-only">Version</legend>
                  {t.versions.map((v) => {
                    const on = t.selected.version === v.version;
                    return (
                      <button
                        key={v.version}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked(v.version)}
                        className={`min-h-11 cursor-pointer rounded-full border px-3.5 text-sm font-extrabold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-text-soft"}`}
                      >
                        v{v.version} · {v.status.toLowerCase()}
                      </button>
                    );
                  })}
                </fieldset>
                {canEdit && !t.archived && (
                  <div className="flex w-full flex-wrap justify-end gap-2 border-t border-line pt-4">
                    {can("templates", "full") && (
                      <Button variant="danger" icon="trash" onClick={() => setArchiving(true)}>
                        Archive
                      </Button>
                    )}
                    <Button variant="outline" icon="edit" onClick={() => setDetails(true)}>
                      Edit details
                    </Button>
                    {!editing && (
                      <Button
                        icon="edit"
                        onClick={() => {
                          setPicked(null);
                          setEditMode(true);
                        }}
                      >
                        Edit template
                      </Button>
                    )}
                  </div>
                )}
              </Card>

              {isDraft && canEdit && !t.archived && (
                <DraftBanner
                  t={t}
                  onDone={() => {
                    setEditMode(false);
                    setPicked(null);
                  }}
                />
              )}
              {editing && !isDraft && (
                <p className="rounded-2xl bg-bg px-4 py-3 text-sm text-text-soft">
                  Showing v{t.selected.version}, which is live. Your first change starts draft v
                  {Math.max(...t.versions.map((v) => v.version)) + 1}; nothing changes for new cases
                  until you publish it.
                </p>
              )}

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <Checklist t={t} editing={editing} />
                <div className="flex flex-col gap-5">
                  <Files t={t} editing={editing} />
                  <KnownFailures t={t} editing={editing} />
                </div>
              </div>

              {details && <DetailsDialog t={t} onClose={() => setDetails(false)} />}
              <FormDialog
                open={archiving}
                onClose={() => setArchiving(false)}
                title={`Archive ${t.name}?`}
                description="No new cases can be opened with it. Open cases are not affected."
                submitLabel="Archive"
                submitVariant="danger"
                pending={archive.isPending}
                onSubmit={async () => {
                  const done = await archive.mutateAsync({ template: t.slug }).catch(() => null);
                  setArchiving(false);
                  if (done) {
                    toast.success(`${t.name} archived`);
                    void navigate({ to: "/templates" });
                  }
                }}
              />
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
