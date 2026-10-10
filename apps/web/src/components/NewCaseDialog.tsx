import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "../lib/toast";
import { errorMessage, useTRPC } from "../trpc";
import { FieldRow, FormDialog, optional, SelectField, TextAreaField, TextField } from "./controls";

/**
 * Opens a case from a published template. The client and template can be preset,
 * e.g. from a client's page or from a deadline that has no case yet.
 */
export function NewCaseDialog({
  open,
  onClose,
  client,
  templateSlug,
  deadlineKind,
}: {
  open: boolean;
  onClose: () => void;
  client?: { id: string; fullName: string };
  templateSlug?: string;
  /** Preselects the first template that resolves this kind of deadline. */
  deadlineKind?: string;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const clients = useQuery({
    ...trpc.clients.list.queryOptions({ limit: 100 }),
    enabled: open && !client,
  });
  const templates = useQuery({
    ...trpc.templates.list.queryOptions({ includeArchived: false }),
    enabled: open,
  });
  const assignees = useQuery({ ...trpc.team.assignees.queryOptions(), enabled: open });
  const create = useMutation(trpc.cases.create.mutationOptions({ meta: { quiet: true } }));

  const published = (templates.data?.items ?? []).filter((t) => t.publishedVersion !== null);
  const [clientId, setClientId] = useState(client?.id ?? "");
  const [template, setTemplate] = useState(templateSlug ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  // Preselect a template once the list arrives.
  useEffect(() => {
    const ready = (templates.data?.items ?? []).filter((t) => t.publishedVersion !== null);
    if (!open || template || ready.length === 0) return;
    const match = deadlineKind ? ready.find((t) => t.deadlineKind === deadlineKind) : undefined;
    setTemplate((match ?? ready[0])?.slug ?? "");
  }, [open, template, templates.data, deadlineKind]);

  function close() {
    create.reset();
    setClientId(client?.id ?? "");
    setTemplate(templateSlug ?? "");
    setAssigneeId("");
    setDueDate("");
    setNotes("");
    onClose();
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      title="Open a case"
      description="The case copies the template's current checklist. Later template edits do not change it."
      submitLabel="Open case"
      pending={create.isPending}
      error={create.error ? errorMessage(create.error) : null}
      onSubmit={async () => {
        const opened = await create
          .mutateAsync({
            clientId: client?.id ?? clientId,
            template,
            ...(assigneeId ? { assigneeId } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(optional(notes) ? { notes: notes.trim() } : {}),
          })
          .catch(() => null);
        if (!opened) return;
        toast.success(`Opened ${opened.number} for ${opened.client.fullName}`);
        close();
        void navigate({ to: "/cases/$number", params: { number: opened.number } });
      }}
    >
      {client ? (
        <div className="rounded-2xl bg-bg px-3.5 py-3 text-sm">
          <span className="text-muted">Client</span>{" "}
          <span className="font-extrabold">{client.fullName}</span>
        </div>
      ) : (
        <SelectField
          label="Client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          hint="New client? Add them on the Clients page first."
          options={[
            { value: "", label: clients.isPending ? "Loading clients…" : "Choose a client" },
            ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.fullName })),
          ]}
        />
      )}
      <SelectField
        label="Case type"
        required
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        hint={
          templates.data && published.length === 0
            ? "No template is published yet. Publish one on the Templates page."
            : undefined
        }
        options={[
          { value: "", label: templates.isPending ? "Loading templates…" : "Choose a template" },
          ...published.map((t) => ({
            value: t.slug,
            label: `${t.name} (v${t.publishedVersion})`,
          })),
        ]}
      />
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
      <TextAreaField
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything the team should know"
      />
    </FormDialog>
  );
}
