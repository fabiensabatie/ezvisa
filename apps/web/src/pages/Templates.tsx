import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Card, CardTitle, Chip, Empty, PageHeader, QueryView } from "../components/ui";
import { fileSize, formatDate, plural } from "../lib/format";
import { DEADLINE_LABEL, TONE } from "../lib/tones";
import { useTRPC } from "../trpc";

export function TemplatesPage() {
  const trpc = useTRPC();
  const list = useQuery(trpc.templates.list.queryOptions({ includeArchived: false }));

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="One per case type: the checklist, forms and known failures every new case starts from"
      />
      <QueryView query={list} what="templates">
        {(data) =>
          data.items.length === 0 ? (
            <Empty>No templates yet. Claude can create one with create_template.</Empty>
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
    </>
  );
}

export function TemplateDetailPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const trpc = useTRPC();
  const [version, setVersion] = useState<number | "published">("published");
  const query = useQuery(trpc.templates.get.queryOptions({ template: slug, version }));

  return (
    <>
      <Link
        to="/templates"
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 font-extrabold text-ink"
      >
        <Icon name="arrowLeft" />
        All templates
      </Link>
      <QueryView query={query} what="This template">
        {(t) => (
          <div className="flex flex-col gap-5">
            <Card className="flex flex-wrap items-center gap-5">
              <span
                className={`grid size-14 shrink-0 place-items-center rounded-2xl ${TONE.accent}`}
              >
                <Icon name="file" size={28} strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1 basis-64">
                <h1 className="font-display text-2xl font-semibold">{t.name}</h1>
                <p className="mt-1 text-sm text-muted">
                  {t.office} ·{" "}
                  {t.deadlineKind ? DEADLINE_LABEL[t.deadlineKind] : "No client deadline"}
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
                      onClick={() => setVersion(v.version)}
                      className={`min-h-11 cursor-pointer rounded-full border px-3.5 text-sm font-extrabold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-text-soft"}`}
                    >
                      v{v.version} · {v.status.toLowerCase()}
                    </button>
                  );
                })}
              </fieldset>
            </Card>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Card>
                <CardTitle
                  sub={
                    t.selected.publishedAt
                      ? `Published ${formatDate(t.selected.publishedAt.slice(0, 10))}${t.selected.notes ? ` · ${t.selected.notes}` : ""}`
                      : (t.selected.notes ?? "Not published yet")
                  }
                  aside={
                    <span className="text-sm text-muted">
                      {plural(t.selected.items.length, "item")}
                    </span>
                  }
                >
                  Checklist
                </CardTitle>
                <ol className="divide-y divide-line">
                  {t.selected.items.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 py-3">
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${TONE.accent}`}
                      >
                        {item.position}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{item.label}</div>
                        {item.description && (
                          <div className="mt-0.5 text-sm text-muted">{item.description}</div>
                        )}
                        {item.rules !== null && item.rules !== undefined && (
                          <div className="mt-1 font-mono text-xs text-muted">
                            {JSON.stringify(item.rules)}
                          </div>
                        )}
                      </div>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {item.kind !== "DOCUMENT" && (
                          <Chip tone="info">{item.kind.toLowerCase()}</Chip>
                        )}
                        {!item.required && <Chip>Optional</Chip>}
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>

              <div className="flex flex-col gap-5">
                <Card>
                  <CardTitle>Forms and files</CardTitle>
                  {t.selected.files.length === 0 ? (
                    <Empty>
                      No forms attached. Claude can attach one with attach_template_file.
                    </Empty>
                  ) : (
                    <ul className="divide-y divide-line">
                      {t.selected.files.map((f) => (
                        <li key={f.id} className="flex items-center gap-3 py-3">
                          <span
                            className={`grid size-10 place-items-center rounded-xl ${TONE.accent}`}
                          >
                            <Icon name="file" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-extrabold">{f.name}</div>
                            <div className="text-xs text-muted">{fileSize(f.sizeBytes)}</div>
                          </div>
                          <Chip tone="accent">{f.kind.replace("_", " ").toLowerCase()}</Chip>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card>
                  <CardTitle
                    icon={{ name: "alert", tone: "warn" }}
                    sub="From Namtarn's notes and past rejections."
                  >
                    Known failures
                  </CardTitle>
                  {t.selected.knownFailures.length === 0 ? (
                    <Empty>None recorded.</Empty>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {t.selected.knownFailures.map((f) => (
                        <li
                          key={f}
                          className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
