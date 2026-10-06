import { useMutation } from "@tanstack/react-query";
import { type DragEvent, useId, useState } from "react";
import { useCan } from "../lib/can";
import { fileSize, timeAgo } from "../lib/format";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { ACCEPT, fileProblem, mimeOf, putFile } from "../lib/upload";
import { errorMessage, useTRPC } from "../trpc";
import { Button, FormDialog } from "./controls";
import { Icon } from "./Icon";
import { Empty } from "./ui";

type Doc = { id: string; filename: string; sizeBytes: number; createdAt: string | null };

/** Stored documents, each opened through a short-lived signed link. */
export function DocumentList({
  documents,
  empty,
  labels,
}: {
  documents: Doc[];
  empty: string;
  /** Extra text per document id, e.g. the checklist item it satisfies. */
  labels?: Record<string, string>;
}) {
  const trpc = useTRPC();
  const { can } = useCan();
  const link = useMutation(trpc.documents.link.mutationOptions({ meta: { keepCache: true } }));
  const remove = useMutation(trpc.documents.delete.mutationOptions());
  const [removing, setRemoving] = useState<Doc | null>(null);

  async function open(id: string) {
    // Open the tab during the click so Safari does not block it, then point it at the link.
    const tab = window.open("", "_blank");
    try {
      const { downloadUrl } = await link.mutateAsync({ documentId: id });
      if (tab) {
        tab.opener = null;
        tab.location.href = downloadUrl;
      } else {
        window.location.assign(downloadUrl);
      }
    } catch {
      tab?.close();
    }
  }

  if (documents.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      <ul className="divide-y divide-line">
        {documents.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE.accent}`}>
              <Icon name="file" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold">{d.filename}</div>
              <div className="truncate text-xs text-muted">
                {fileSize(d.sizeBytes)} · {timeAgo(d.createdAt ?? "")}
                {labels?.[d.id] && ` · ${labels[d.id]}`}
              </div>
            </div>
            {can("documents", "full") && (
              <Button
                variant="ghost"
                aria-label={`Remove ${d.filename}`}
                title="Remove"
                className="!px-3"
                onClick={() => setRemoving(d)}
              >
                <Icon name="trash" size={16} />
              </Button>
            )}
            <Button
              variant="soft"
              pending={link.isPending && link.variables?.documentId === d.id}
              onClick={() => open(d.id)}
            >
              Open
              <Icon name="external" size={15} />
            </Button>
          </li>
        ))}
      </ul>
      <FormDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this document?"
        description={`${removing?.filename ?? ""} disappears from the dashboard and from Claude. The stored copy is kept until the retention period ends.`}
        submitLabel="Remove"
        submitVariant="danger"
        pending={remove.isPending}
        onSubmit={async () => {
          if (!removing) return;
          await remove.mutateAsync({ documentId: removing.id }).catch(() => undefined);
          setRemoving(null);
        }}
      />
    </>
  );
}

/** Uploads files for a client, optionally onto a case or a checklist item. */
export function useDocumentUpload(target: {
  clientId: string;
  case?: string;
  caseItemId?: string;
}) {
  const trpc = useTRPC();
  const create = useMutation(
    trpc.documents.createUpload.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );
  const confirm = useMutation(
    trpc.documents.confirmUpload.mutationOptions({ meta: { quiet: true } }),
  );
  const [busy, setBusy] = useState(false);

  async function upload(files: File[]): Promise<number> {
    setBusy(true);
    let done = 0;
    try {
      for (const file of files) {
        const problem = fileProblem(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        const mimeType = mimeOf(file);
        try {
          const link = await create.mutateAsync({
            clientId: target.clientId,
            filename: file.name,
            mimeType,
            sizeBytes: file.size,
          });
          await putFile(link, file);
          await confirm.mutateAsync({
            uploadKey: link.uploadKey,
            clientId: target.clientId,
            filename: file.name,
            mimeType,
            ...(target.case ? { case: target.case } : {}),
            ...(target.caseItemId ? { caseItemId: target.caseItemId } : {}),
          });
          done++;
          toast.success(`Uploaded ${file.name}`);
        } catch (error) {
          toast.error(`${file.name}: ${errorMessage(error)}`);
        }
      }
    } finally {
      setBusy(false);
    }
    return done;
  }

  return { upload, busy };
}

/** Click to pick files, or drop them here. */
export function FileDrop({
  onFiles,
  busy,
  title,
  hint,
  multiple = true,
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  title: string;
  hint?: string;
  multiple?: boolean;
}) {
  const id = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    if (!busy && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  };

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors focus-within:border-accent ${
        over ? "border-accent bg-soft" : "border-line bg-bg hover:border-accent"
      } ${busy ? "cursor-wait opacity-70" : ""}`}
    >
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        disabled={busy}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {busy ? (
        <span className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
      ) : (
        <span className={`grid size-10 place-items-center rounded-xl ${TONE.accent}`}>
          <Icon name="upload" />
        </span>
      )}
      <span className="text-sm font-extrabold">{busy ? "Uploading…" : title}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
