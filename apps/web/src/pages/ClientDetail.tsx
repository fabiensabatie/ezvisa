import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ClientDialog } from "../components/ClientDialog";
import { Button } from "../components/controls";
import { DocumentList, FileDrop, useDocumentUpload } from "../components/DocumentList";
import { Icon } from "../components/Icon";
import { NewCaseDialog } from "../components/NewCaseDialog";
import { Avatar, Card, CardTitle, Chip, Empty, Label, Progress, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { countryName, formatDate, formatInstant, relativeDays } from "../lib/format";
import { CHANNEL_LABEL, DEADLINE_LABEL, dueTone, stage, TONE } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";

type Client = Outputs["clients"]["get"];

function Actions({ c }: { c: Client }) {
  const { can } = useCan();
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  if (!can("clients", "edit") && !can("cases", "edit")) return null;
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      {can("clients", "edit") && (
        <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      {can("cases", "edit") && (
        <Button icon="plus" onClick={() => setOpening(true)}>
          Open a case
        </Button>
      )}
      {editing && <ClientDialog open client={c} onClose={() => setEditing(false)} />}
      <NewCaseDialog
        open={opening}
        onClose={() => setOpening(false)}
        client={{ id: c.id, fullName: c.fullName }}
      />
    </div>
  );
}

function Documents({ c }: { c: Client }) {
  const { can } = useCan();
  const { upload, busy } = useDocumentUpload({ clientId: c.id });
  return (
    <Card>
      <CardTitle icon={{ name: "upload" }}>Documents</CardTitle>
      <DocumentList documents={c.documents} empty="No documents stored." />
      {can("documents", "edit") && (
        <div className="mt-3">
          {c.consentAt ? (
            <FileDrop
              busy={busy}
              title="Add documents"
              hint="Kept on the client, outside any case. PDF, photos or DOCX, up to 20 MB each."
              onFiles={(files) => void upload(files)}
            />
          ) : (
            <p className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
              Record the client's privacy consent (Edit) before storing their documents.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 font-bold">
        {children ?? <span className="font-semibold text-muted">Not recorded</span>}
      </div>
    </div>
  );
}

export function ClientDetailPage() {
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const trpc = useTRPC();
  const query = useQuery(trpc.clients.get.queryOptions({ clientId }));

  return (
    <>
      <Link
        to="/clients"
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 font-extrabold text-ink"
      >
        <Icon name="arrowLeft" />
        All clients
      </Link>
      <QueryView query={query} what="This client">
        {(c) => (
          <div className="flex flex-col gap-5">
            <Card className="flex flex-wrap items-center gap-5">
              <Avatar name={c.fullName} id={c.id} size="lg" square />
              <div className="min-w-0 flex-1 basis-64">
                <h1 className="font-display text-2xl font-semibold">{c.fullName}</h1>
                <p className="mt-1 text-sm text-muted">
                  {countryName(c.nationality)} · {c.visaType ?? "visa not recorded"} · client since{" "}
                  {formatInstant(c.createdAt)}
                </p>
              </div>
              {c.consentAt ? (
                <Chip tone="ok" icon="check">
                  Privacy consent given
                </Chip>
              ) : (
                <Chip tone="warn" icon="alert">
                  No privacy consent yet
                </Chip>
              )}
              <Actions c={c} />
            </Card>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card>
                <CardTitle>Details</CardTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Passport">{c.passportNo}</Field>
                  <Field label="Date of birth">
                    {c.dateOfBirth ? formatDate(c.dateOfBirth) : null}
                  </Field>
                  <Field label="Email">{c.email}</Field>
                  <Field label="Phone">{c.phone}</Field>
                  <Field label="Channel">
                    {CHANNEL_LABEL[c.channel] ?? c.channel}
                    {c.channelHandle ? ` · ${c.channelHandle}` : ""}
                  </Field>
                  <Field label="Address">{c.address}</Field>
                </div>
                {c.notes && (
                  <p className="mt-4 whitespace-pre-line rounded-2xl bg-bg p-3.5 text-sm text-text-soft">
                    {c.notes}
                  </p>
                )}
              </Card>

              <Card>
                <CardTitle icon={{ name: "calendar" }}>Deadlines</CardTitle>
                {c.deadlines.length === 0 ? (
                  <Empty>No dates recorded.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {c.deadlines.map((d) => (
                      <li key={d.kind} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <div className="font-extrabold">{formatDate(d.date)}</div>
                          <div className="text-sm text-muted">{DEADLINE_LABEL[d.kind]}</div>
                        </div>
                        <Chip tone={dueTone(d.daysLeft)}>{relativeDays(d.daysLeft)}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card>
              <CardTitle icon={{ name: "folder" }}>Cases</CardTitle>
              {c.cases.length === 0 ? (
                <Empty>No cases yet.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {c.cases.map((k) => {
                    const s = stage(k.stage);
                    return (
                      <li key={k.id}>
                        <Link
                          to="/cases/$number"
                          params={{ number: k.number }}
                          className="-mx-2 flex flex-wrap items-center gap-4 rounded-2xl px-2 py-3 hover:bg-bg"
                        >
                          <span className="font-mono text-sm text-muted">{k.number}</span>
                          <span className="min-w-40 flex-1 font-extrabold">{k.template.name}</span>
                          <span className="w-40">
                            <Progress
                              value={k.progress.received}
                              max={k.progress.requiredItems}
                              thin
                            />
                          </span>
                          <Chip tone={s.tone}>{s.label}</Chip>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Documents c={c} />
          </div>
        )}
      </QueryView>
    </>
  );
}
