import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Button,
  CheckboxField,
  FieldRow,
  FormDialog,
  IconButton,
  INPUT,
  nullable,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/controls";
import { Icon, type IconName } from "../components/Icon";
import {
  Avatar,
  Card,
  CardTitle,
  Chip,
  Empty,
  Label,
  PageHeader,
  QueryView,
} from "../components/ui";
import { useCan } from "../lib/can";
import { formatInstant } from "../lib/format";
import { toast } from "../lib/toast";
import type { Tone } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type UsefulLink = Outputs["links"]["list"]["items"][number];
type Category = UsefulLink["category"];
type Audience = UsefulLink["audience"];

const CATEGORIES: ReadonlyArray<{
  key: Category;
  name: string;
  sub: string;
  icon: IconName;
  tone: Tone;
}> = [
  {
    key: "IMMIGRATION",
    name: "Immigration",
    sub: "Visas, extensions and reporting with the Immigration Bureau.",
    icon: "building",
    tone: "accent",
  },
  {
    key: "WORK_PERMITS",
    name: "Work permits",
    sub: "Department of Employment and BOI services for employers and staff.",
    icon: "badge",
    tone: "info",
  },
  {
    key: "DOCUMENTS",
    name: "Documents & legalisation",
    sub: "Translations, certifications and Thai consular services.",
    icon: "file",
    tone: "warn",
  },
  {
    key: "INSURANCE_MONEY",
    name: "Insurance & money",
    sub: "Health insurance, tax and social security checks.",
    icon: "heart",
    tone: "ok",
  },
  {
    key: "OTHER",
    name: "Other",
    sub: "Anything else the team finds useful.",
    icon: "link",
    tone: "mute",
  },
];

const AUDIENCES: ReadonlyArray<{ value: Audience; label: string }> = [
  { value: "TEAM", label: "Our team" },
  { value: "CLIENT", label: "Client applies themselves" },
  { value: "BOTH", label: "Both" },
];

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function matches(link: UsefulLink, query: string): boolean {
  if (!query) return true;
  return `${link.name} ${link.url} ${link.note ?? ""}`.toLowerCase().includes(query);
}

// ---- dialog ----------------------------------------------------------------------

function LinkDialog({
  link,
  canDelete,
  onClose,
}: {
  link?: UsefulLink;
  canDelete: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const create = useMutation(trpc.links.create.mutationOptions({ meta: { quiet: true } }));
  const update = useMutation(trpc.links.update.mutationOptions({ meta: { quiet: true } }));
  const remove = useMutation(trpc.links.delete.mutationOptions());
  const mutation = link ? update : create;
  const [url, setUrl] = useState(link?.url ?? "");
  const [name, setName] = useState(link?.name ?? "");
  const [category, setCategory] = useState<Category>(link?.category ?? "IMMIGRATION");
  const [audience, setAudience] = useState<Audience>(link?.audience ?? "TEAM");
  const [note, setNote] = useState(link?.note ?? "");
  const [needsLogin, setNeedsLogin] = useState(link?.needsLogin ?? false);
  const [pinned, setPinned] = useState(link?.pinned ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <FormDialog
      open
      onClose={onClose}
      title={link ? `Edit ${link.name}` : "Add a link"}
      description="Everyone in the agency sees it. Add a note so new staff know when to use it."
      submitLabel={link ? "Save" : "Add link"}
      pending={mutation.isPending}
      error={mutation.error ? errorMessage(mutation.error) : null}
      onSubmit={async () => {
        const values = {
          url: url.trim(),
          name: name.trim(),
          category,
          audience,
          note: nullable(note),
          needsLogin,
          pinned,
        };
        const saved = link
          ? await update.mutateAsync({ linkId: link.id, ...values }).catch(() => null)
          : await create.mutateAsync(values).catch(() => null);
        if (!saved) return;
        toast.success(link ? `${saved.name} saved` : `${saved.name} added`);
        onClose();
      }}
    >
      <TextField
        label="Web address"
        type="url"
        required
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <TextField
        label="Name"
        required
        placeholder="e.g. Thai e-Visa"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FieldRow>
        <SelectField
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          options={CATEGORIES.map((c) => ({ value: c.key, label: c.name }))}
        />
        <SelectField
          label="Who uses it"
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
          options={AUDIENCES}
        />
      </FieldRow>
      <TextAreaField
        label="When to use it"
        hint="Shown under the link. One or two sentences."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <CheckboxField label="Needs the agency login" checked={needsLogin} onChange={setNeedsLogin} />
      <CheckboxField
        label="Pin for the whole team"
        hint="Pinned links show at the top of the page."
        checked={pinned}
        onChange={setPinned}
      />
      {link && canDelete && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg px-3.5 py-3">
          <span className="mr-auto text-sm text-muted">
            {confirmDelete ? `Delete ${link.name} for everyone?` : "No longer useful?"}
          </span>
          {confirmDelete && (
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
          )}
          <Button
            variant="danger"
            icon="trash"
            pending={remove.isPending}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              remove.mutate(
                { linkId: link.id },
                {
                  onSuccess: () => {
                    toast.success(`${link.name} deleted`);
                    onClose();
                  },
                },
              );
            }}
          >
            {confirmDelete ? "Delete" : "Delete link"}
          </Button>
        </div>
      )}
    </FormDialog>
  );
}

// ---- list ------------------------------------------------------------------------

function CheckedLine({ link }: { link: UsefulLink }) {
  if (!link.checkedAt) {
    return (
      <Chip tone="warn" icon="alert">
        Not checked yet
      </Chip>
    );
  }
  const when = formatInstant(link.checkedAt);
  if (link.needsCheck) {
    return (
      <Chip tone="warn" icon="alert">
        Last checked {when}
      </Chip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Icon name="check" size={12} />
      Checked {when}
      {link.checkedBy ? ` by ${link.checkedBy}` : ""}
    </span>
  );
}

function LinkRow({
  link,
  editable,
  onEdit,
}: {
  link: UsefulLink;
  editable: boolean;
  onEdit: () => void;
}) {
  const trpc = useTRPC();
  const update = useMutation(trpc.links.update.mutationOptions());
  const markChecked = useMutation(trpc.links.markChecked.mutationOptions());

  return (
    <li className="flex flex-wrap items-start gap-3 border-t border-line py-3.5 first:border-t-0 sm:flex-nowrap">
      <Avatar name={link.name} id={link.id} square />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-extrabold hover:text-ink hover:underline hover:underline-offset-4"
          >
            {link.name}
          </a>
          <span className="break-all text-xs text-muted">{host(link.url)}</span>
        </div>
        {link.note && (
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-text-soft">{link.note}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {link.needsLogin && (
            <Chip tone="warn" icon="key">
              Login needed
            </Chip>
          )}
          {link.audience === "CLIENT" && <Chip tone="info">Client applies</Chip>}
          {link.audience === "BOTH" && <Chip tone="accent">Team & client</Chip>}
          <CheckedLine link={link} />
          {editable && link.needsCheck && (
            <button
              type="button"
              disabled={markChecked.isPending}
              onClick={() =>
                markChecked.mutate(
                  { linkId: link.id },
                  { onSuccess: () => toast.success(`${link.name} marked as working`) },
                )
              }
              className="cursor-pointer rounded-full px-2 py-1 text-xs font-extrabold text-ink underline underline-offset-2 disabled:opacity-60"
            >
              It still works
            </button>
          )}
        </div>
      </div>
      <div className="flex w-full shrink-0 gap-1 pl-[52px] sm:w-auto sm:pl-0">
        {editable && (
          <IconButton
            icon="star"
            label={link.pinned ? `Unpin ${link.name}` : `Pin ${link.name} for the team`}
            aria-pressed={link.pinned}
            variant="ghost"
            className={link.pinned ? "text-ink [&_svg]:fill-current" : "text-muted"}
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { linkId: link.id, pinned: !link.pinned },
                {
                  onSuccess: () =>
                    toast.success(link.pinned ? `Unpinned ${link.name}` : `Pinned ${link.name}`),
                },
              )
            }
          />
        )}
        <IconButton
          icon="copy"
          label={`Copy the address of ${link.name}`}
          variant="ghost"
          className="text-muted"
          onClick={async () => {
            if (await copy(link.url)) toast.success("Link copied");
            else toast.error(`The link could not be copied. It is ${link.url}`);
          }}
        />
        {editable && (
          <IconButton
            icon="edit"
            label={`Edit ${link.name}`}
            variant="ghost"
            className="text-muted"
            onClick={onEdit}
          />
        )}
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${link.name}`}
          title="Open"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-soft text-ink"
        >
          <Icon name="external" size={17} />
        </a>
      </div>
    </li>
  );
}

function PinnedLinks({ links }: { links: UsefulLink[] }) {
  return (
    <section className="mb-7">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Icon name="star" size={14} className="fill-current text-muted" />
        <Label>Pinned for the team</Label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-3 rounded-[20px] border border-line bg-white p-3.5 shadow-card transition-transform hover:-translate-y-0.5 hover:shadow-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <Avatar name={link.name} id={link.id} square />
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold">{link.name}</div>
              <div className="truncate text-xs text-muted">{host(link.url)}</div>
            </div>
            <Icon name="external" size={16} className="ml-auto text-muted" />
          </a>
        ))}
      </div>
    </section>
  );
}

export function LinksPage() {
  const trpc = useTRPC();
  const { can, human } = useCan();
  const query = useQuery(trpc.links.list.queryOptions({}));
  const editable = human && can("links", "edit");
  const canDelete = human && can("links", "full");
  const [filter, setFilter] = useState<Category | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ link?: UsefulLink } | null>(null);
  const q = search.trim().toLowerCase();

  return (
    <div>
      <PageHeader
        title="Useful links"
        subtitle="Government portals, forms and references the team uses every day. Shared with everyone in the agency."
      >
        {editable && (
          <Button icon="plus" onClick={() => setDialog({})}>
            Add link
          </Button>
        )}
      </PageHeader>

      <QueryView query={query} what="the useful links">
        {({ items }) => {
          const counts = new Map<Category, number>();
          for (const l of items) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
          const pinned = items.filter((l) => l.pinned);
          const groups = CATEGORIES.filter(
            (c) =>
              (filter === "ALL" || c.key === filter) && (c.key !== "OTHER" || counts.has(c.key)),
          )
            .map((c) => ({
              ...c,
              links: items.filter((l) => l.category === c.key && matches(l, q)),
            }))
            .filter((g) => !q || g.links.length > 0);
          const filters = [
            { key: "ALL" as const, name: "All", count: items.length },
            ...CATEGORIES.filter((c) => counts.has(c.key)).map((c) => ({
              key: c.key,
              name: c.name,
              count: counts.get(c.key) ?? 0,
            })),
          ];

          return (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-[1_1_280px]">
                  <Icon
                    name="search"
                    className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
                  />
                  <input
                    type="search"
                    aria-label="Search links"
                    placeholder="Search by name, site or what it's for"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className={`h-11 pl-10 ${INPUT}`}
                  />
                </div>
                <fieldset className="flex flex-wrap gap-1.5">
                  <legend className="sr-only">Filter by category</legend>
                  {filters.map((f) => {
                    const on = filter === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFilter(f.key)}
                        className={`min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-extrabold ${
                          on
                            ? "border-ink bg-ink text-white"
                            : "border-line bg-white text-text-soft"
                        }`}
                      >
                        {f.name}
                        <span className="ml-1 tabular-nums opacity-70">{f.count}</span>
                      </button>
                    );
                  })}
                </fieldset>
              </div>

              {filter === "ALL" && !q && pinned.length > 0 && <PinnedLinks links={pinned} />}

              {groups.length === 0 ? (
                <Card>
                  <Empty>
                    No links match “{search.trim()}”. Try part of a site name, such as “immigration”
                    {editable ? ", or add the link" : ""}.
                  </Empty>
                </Card>
              ) : (
                <div className="grid items-start gap-5 xl:grid-cols-2">
                  {groups.map((g) => (
                    <Card key={g.key} className="min-w-0">
                      <CardTitle
                        icon={{ name: g.icon, tone: g.tone }}
                        sub={g.sub}
                        aside={
                          <span className="text-sm font-bold text-muted">
                            {g.links.length} {g.links.length === 1 ? "link" : "links"}
                          </span>
                        }
                      >
                        {g.name}
                      </CardTitle>
                      {g.links.length === 0 ? (
                        <Empty>No {g.name.toLowerCase()} links yet.</Empty>
                      ) : (
                        <ul className="flex flex-col">
                          {g.links.map((link) => (
                            <LinkRow
                              key={link.id}
                              link={link}
                              editable={editable}
                              onEdit={() => setDialog({ link })}
                            />
                          ))}
                        </ul>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </QueryView>

      {dialog && (
        <LinkDialog link={dialog.link} canDelete={canDelete} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
