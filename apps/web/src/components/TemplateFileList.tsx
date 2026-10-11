import { useMutation } from "@tanstack/react-query";
import { fileSize } from "../lib/format";
import { downloadFrom, openInNewTab } from "../lib/open";
import { TONE } from "../lib/tones";
import { useTRPC } from "../trpc";
import { Button, IconButton } from "./controls";
import { Icon } from "./Icon";
import { Chip, Empty } from "./ui";

type TemplateFile = { id: string; name: string; kind: string; sizeBytes: number };

export const FILE_KIND_LABEL: Record<string, string> = {
  PDF_FORM: "Form to fill in",
  LETTER: "Letter template",
  REFERENCE: "Reference",
};

/** Opens or downloads one template file. Through a case it needs only case access. */
export function useTemplateFileLink(caseNumber?: string) {
  const trpc = useTRPC();
  const link = useMutation(trpc.templates.fileLink.mutationOptions({ meta: { keepCache: true } }));
  const linkTo = (fileId: string, download: boolean) => async () =>
    (
      await link.mutateAsync({
        fileId,
        download,
        ...(caseNumber ? { case: caseNumber } : {}),
      })
    ).downloadUrl;
  return {
    open: (fileId: string) => openInNewTab(linkTo(fileId, false)),
    download: (fileId: string) => downloadFrom(linkTo(fileId, true)),
    opening: (fileId: string) =>
      link.isPending && link.variables?.fileId === fileId && !link.variables.download,
  };
}

/** A template's forms, letters and reference files, each with Open and Download. */
export function TemplateFileList({
  files,
  empty,
  caseNumber,
  onRemove,
}: {
  files: TemplateFile[];
  empty: string;
  /** Opens files as part of this case, for people with case access only. */
  caseNumber?: string;
  onRemove?: (file: TemplateFile) => void;
}) {
  const link = useTemplateFileLink(caseNumber);
  if (files.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE.accent}`}>
            <Icon name="file" />
          </span>
          <div className="min-w-0 flex-1 basis-32">
            <div className="truncate text-sm font-extrabold">{f.name}</div>
            <div className="text-xs text-muted">{fileSize(f.sizeBytes)}</div>
          </div>
          <Chip tone="accent">{FILE_KIND_LABEL[f.kind] ?? f.kind}</Chip>
          <span className="flex items-center gap-1">
            {onRemove && (
              <IconButton
                icon="trash"
                label={`Remove ${f.name}`}
                variant="ghost"
                onClick={() => onRemove(f)}
              />
            )}
            <IconButton
              icon="download"
              label={`Download ${f.name}`}
              variant="ghost"
              onClick={() => link.download(f.id)}
            />
            <Button variant="soft" pending={link.opening(f.id)} onClick={() => link.open(f.id)}>
              Open
              <Icon name="external" size={15} />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
