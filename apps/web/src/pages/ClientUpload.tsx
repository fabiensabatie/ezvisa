import { applyTheme } from "@ezvisa/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, CheckboxField, INPUT } from "../components/controls";
import { Flower } from "../components/Flower";
import { Icon } from "../components/Icon";
import { Toaster } from "../components/Toaster";
import { Chip, Progress } from "../components/ui";
import { fileSize, formatInstant } from "../lib/format";
import { downloadFrom, openInNewTab } from "../lib/open";
import { toast } from "../lib/toast";
import type { Tone } from "../lib/tones";
import { ACCEPT, fileProblem, mimeOf, putFile } from "../lib/upload";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Page = Outputs["upload"]["view"];
type Item = Page["items"][number];
type Files = Outputs["upload"]["files"];
type SentFile = Files["items"][number]["files"][number];
/** Opened with the client's date of birth, kept in memory for this visit only. */
type Access = { dateOfBirth: string; files: Files };

const STATE: Record<Item["state"], { label: string; tone: Tone }> = {
  needed: { label: "Needed", tone: "accent" },
  again: { label: "Please send a new copy", tone: "warn" },
  received: { label: "Received, being checked", tone: "info" },
  done: { label: "Done", tone: "ok" },
};

/** The link's secret is in the fragment: browsers never send it to the server. */
function secretFromUrl(): string {
  return decodeURIComponent(window.location.hash.replace(/^#/, ""));
}

const quiet = { meta: { keepCache: true, quiet: true } };

function Shell({ agentName, children }: { agentName?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-6 sm:py-10">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <header className="flex items-center gap-2.5">
          <Flower size={40} />
          <div>
            <div className="font-display text-xl font-semibold leading-none">
              {agentName ?? "EzVisa"}
            </div>
            <div className="mt-1 text-xs text-muted">Visa documents, sent securely</div>
          </div>
        </header>
        {children}
      </div>
      <Toaster />
    </div>
  );
}

/** One file the client sent: open, save, and while the item is not checked, replace or remove. */
function SentFileRow({
  file,
  canChange,
  secret,
  access,
  busy,
  onReplace,
  onRemoved,
}: {
  file: SentFile;
  canChange: boolean;
  secret: string;
  access: Access;
  busy: boolean;
  onReplace: () => void;
  onRemoved: (result: { page: Page; files: Files }) => void;
}) {
  const trpc = useTRPC();
  const link = useMutation(trpc.upload.fileLink.mutationOptions(quiet));
  const remove = useMutation(trpc.upload.removeFile.mutationOptions(quiet));
  const [confirming, setConfirming] = useState(false);
  const get = (download: boolean) => () =>
    link
      .mutateAsync({ secret, dateOfBirth: access.dateOfBirth, documentId: file.id, download })
      .then((r) => r.url)
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        throw error;
      });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg px-3 py-2">
      <Icon name="file" size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate text-sm font-bold">{file.filename}</div>
        <div className="text-xs text-muted">
          {fileSize(file.sizeBytes)} · sent {formatInstant(file.uploadedAt)}
        </div>
      </div>
      <span className="flex flex-wrap gap-1">
        <Button variant="ghost" onClick={() => void openInNewTab(get(false))}>
          View
        </Button>
        <Button variant="ghost" icon="download" onClick={() => void downloadFrom(get(true))}>
          Save
        </Button>
        {canChange && (
          <>
            <Button variant="ghost" pending={busy} onClick={onReplace}>
              Replace
            </Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                remove.mutate(
                  { secret, dateOfBirth: access.dateOfBirth, documentId: file.id },
                  {
                    onSuccess: (result) => {
                      setConfirming(false);
                      onRemoved(result);
                      toast.success(`${file.filename} removed`);
                    },
                    onError: (error) => toast.error(errorMessage(error)),
                  },
                );
              }}
            >
              {confirming ? "Tap again to remove" : "Remove"}
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function ItemCard({
  item,
  secret,
  access,
  onPage,
  onFiles,
}: {
  item: Item;
  secret: string;
  access: Access | null;
  onPage: (page: Page) => void;
  onFiles: (files: Files) => void;
}) {
  const trpc = useTRPC();
  const input = useRef<HTMLInputElement>(null);
  const create = useMutation(trpc.upload.createUpload.mutationOptions(quiet));
  const confirm = useMutation(trpc.upload.confirmUpload.mutationOptions(quiet));
  const listFiles = useMutation(trpc.upload.files.mutationOptions(quiet));
  const remove = useMutation(trpc.upload.removeFile.mutationOptions(quiet));
  const [busy, setBusy] = useState(false);
  /** The file a "Replace" will remove once its new copy has arrived. */
  const replacing = useRef<string | null>(null);
  const state = STATE[item.state];
  const sent = access?.files.items.find((i) => i.itemId === item.id);

  async function send(files: File[]) {
    setBusy(true);
    const replace = replacing.current;
    replacing.current = null;
    try {
      let uploaded = false;
      for (const file of files) {
        const problem = fileProblem(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        const mimeType = mimeOf(file);
        const link = await create.mutateAsync({
          secret,
          itemId: item.id,
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
        });
        await putFile(link, file);
        onPage(
          await confirm.mutateAsync({
            secret,
            itemId: item.id,
            uploadKey: link.uploadKey,
            filename: file.name,
            mimeType,
          }),
        );
        uploaded = true;
        toast.success(`Thank you, ${item.label} received`);
      }
      if (access && uploaded && replace) {
        const result = await remove.mutateAsync({
          secret,
          dateOfBirth: access.dateOfBirth,
          documentId: replace,
        });
        onPage(result.page);
        onFiles(result.files);
      } else if (access && uploaded) {
        onFiles(await listFiles.mutateAsync({ secret, dateOfBirth: access.dateOfBirth }));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const pick = (replace: string | null) => {
    replacing.current = replace;
    input.current?.click();
  };

  return (
    <li className="rounded-3xl border border-line bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold">{item.label}</span>
            {!item.required && <Chip>Optional</Chip>}
          </div>
          {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
        </div>
        <Chip tone={state.tone}>{state.label}</Chip>
      </div>
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
          if (files.length) void send(replacing.current ? files.slice(0, 1) : files);
          else replacing.current = null;
        }}
      />
      {item.state !== "done" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            icon="upload"
            variant={item.state === "received" ? "outline" : "primary"}
            pending={busy}
            className="w-full sm:w-auto"
            onClick={() => pick(null)}
          >
            {item.state === "received" ? "Add another file" : "Upload"}
          </Button>
          {item.files > 0 && !sent && (
            <span className="text-xs text-muted">
              {item.files} file{item.files > 1 ? "s" : ""} sent
            </span>
          )}
        </div>
      )}
      {access && sent && sent.files.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" aria-label={`Files sent for ${item.label}`}>
          {sent.files.map((file) => (
            <SentFileRow
              key={file.id}
              file={file}
              canChange={sent.canChange}
              secret={secret}
              access={access}
              busy={busy}
              onReplace={() => pick(file.id)}
              onRemoved={(result) => {
                onPage(result.page);
                onFiles(result.files);
              }}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Opens the client's files with their date of birth, for this visit only. */
function FilesAccess({
  page,
  secret,
  access,
  onAccess,
}: {
  page: Page;
  secret: string;
  access: Access | null;
  onAccess: (access: Access | null) => void;
}) {
  const trpc = useTRPC();
  const open = useMutation(trpc.upload.files.mutationOptions(quiet));
  const [asking, setAsking] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const anySent = page.items.some((i) => i.files > 0);

  if (!page.canViewFiles || !anySent) return null;
  if (access) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-sm shadow-card">
        <span className="font-bold">Your files are shown under each document.</span>
        <Button variant="ghost" onClick={() => onAccess(null)}>
          Hide them
        </Button>
      </div>
    );
  }
  return (
    <section className="rounded-3xl border border-line bg-white p-5 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Icon name="key" size={18} className="text-ink" />
        See what you sent
      </h2>
      <p className="mt-1 text-sm text-text-soft">
        To view, save, replace or remove your files, confirm your date of birth. It keeps your
        documents private if this link is shared.
      </p>
      {asking ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            open.mutate(
              { secret, dateOfBirth },
              { onSuccess: (files) => onAccess({ dateOfBirth, files }) },
            );
          }}
        >
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm font-extrabold">
            Date of birth
            <input
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className={`h-11 ${INPUT}`}
            />
          </label>
          <Button type="submit" pending={open.isPending} disabled={!dateOfBirth}>
            Show my files
          </Button>
          {open.error && (
            <p role="alert" className="w-full text-sm font-bold text-[#A32A2A]">
              {errorMessage(open.error)}
            </p>
          )}
        </form>
      ) : (
        <Button variant="outline" className="mt-3" onClick={() => setAsking(true)}>
          See my files
        </Button>
      )}
    </section>
  );
}

/** What a client sees when they open the link their visa agent sent. */
export function ClientUploadPage() {
  const trpc = useTRPC();
  const [secret] = useState(secretFromUrl);
  const [page, setPage] = useState<Page | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [agree, setAgree] = useState(false);
  const view = useMutation(trpc.upload.view.mutationOptions(quiet));
  const accept = useMutation(trpc.upload.acceptPrivacyNotice.mutationOptions(quiet));

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once for this link.
  useEffect(() => {
    if (!secret) return;
    view.mutate({ secret }, { onSuccess: setPage });
  }, [secret]);

  useEffect(() => {
    if (page?.accent) applyTheme(page.accent);
  }, [page?.accent]);

  if (!secret || view.isError) {
    return (
      <Shell>
        <section className="rounded-3xl border border-line bg-white p-6 shadow-card">
          <h1 className="font-display text-2xl font-semibold">This link does not work</h1>
          <p className="mt-2 text-text-soft">
            {secret
              ? errorMessage(view.error)
              : "The link is incomplete. Open it again from the message you received."}
          </p>
        </section>
      </Shell>
    );
  }
  if (!page) {
    return (
      <Shell>
        <div className="h-48 animate-pulse rounded-3xl bg-white/70" aria-busy="true" />
      </Shell>
    );
  }

  const sent = page.items.filter((i) => i.state === "received" || i.state === "done").length;

  return (
    <Shell agentName={page.agentName}>
      <section className="rounded-3xl bg-soft p-5 sm:p-6">
        <h1 className="font-display text-2xl font-semibold">Hi {page.firstName}</h1>
        <p className="mt-1.5 text-text-soft">
          Please send the documents below for your {page.caseType}. Take a clear photo or upload a
          PDF; each one goes straight to {page.agentName}.
        </p>
        <div className="mt-4">
          <Progress value={sent} max={page.items.length} />
          <p className="mt-1.5 text-xs font-bold text-text-soft">
            {sent} of {page.items.length} sent
          </p>
        </div>
      </section>

      {page.consentGiven ? (
        <>
          <ul className="flex flex-col gap-3">
            {page.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                secret={secret}
                access={access}
                onPage={setPage}
                onFiles={(files) => setAccess((a) => (a ? { ...a, files } : a))}
              />
            ))}
          </ul>
          <FilesAccess page={page} secret={secret} access={access} onAccess={setAccess} />
        </>
      ) : (
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <Icon name="key" size={20} className="text-ink" />
            Before you start
          </h2>
          <p className="text-sm leading-relaxed text-text-soft">
            {page.agentName} keeps the documents you send to prepare your application with Thai
            Immigration. They are stored securely, seen only by {page.agentName}'s team, and deleted
            12 months after your case is finished.
          </p>
          <CheckboxField
            label={`I agree that ${page.agentName} stores my documents for my application`}
            checked={agree}
            onChange={setAgree}
          />
          {accept.error && (
            <p role="alert" className="text-sm font-bold text-[#A32A2A]">
              {errorMessage(accept.error)}
            </p>
          )}
          <Button
            disabled={!agree}
            pending={accept.isPending}
            onClick={() => accept.mutate({ secret }, { onSuccess: setPage })}
          >
            Continue
          </Button>
        </section>
      )}

      <p className="text-center text-xs text-muted">
        This link works until {formatInstant(page.expiresAt)}. Questions? Reply to {page.agentName}{" "}
        in your chat.
      </p>
    </Shell>
  );
}
