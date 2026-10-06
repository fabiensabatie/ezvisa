import { useMutation } from "@tanstack/react-query";
import { fileSize, timeAgo } from "../lib/format";
import { TONE } from "../lib/tones";
import { useTRPC } from "../trpc";
import { Icon } from "./Icon";
import { Empty } from "./ui";

type Doc = { id: string; filename: string; sizeBytes: number; createdAt: string | null };

/** Stored documents, each opened through a short-lived signed link. */
export function DocumentList({ documents, empty }: { documents: Doc[]; empty: string }) {
  const trpc = useTRPC();
  const link = useMutation(trpc.documents.link.mutationOptions());

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
              <div className="text-xs text-muted">
                {fileSize(d.sizeBytes)} · {timeAgo(d.createdAt ?? "")}
              </div>
            </div>
            <button
              type="button"
              disabled={link.isPending && link.variables?.documentId === d.id}
              onClick={() => open(d.id)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full bg-soft px-4 text-sm font-extrabold text-ink disabled:cursor-wait disabled:opacity-60"
            >
              Open
              <Icon name="external" size={15} />
            </button>
          </li>
        ))}
      </ul>
      {link.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-[#A32A2A]">
          {link.error.message}
        </p>
      )}
    </>
  );
}
