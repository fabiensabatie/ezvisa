import { applyTheme } from "@ezvisa/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, CheckboxField } from "../components/controls";
import { Flower } from "../components/Flower";
import { Icon } from "../components/Icon";
import { Toaster } from "../components/Toaster";
import { Chip, Progress } from "../components/ui";
import { formatInstant } from "../lib/format";
import { toast } from "../lib/toast";
import type { Tone } from "../lib/tones";
import { ACCEPT, fileProblem, mimeOf, putFile } from "../lib/upload";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Page = Outputs["upload"]["view"];
type Item = Page["items"][number];

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

function ItemCard({
  item,
  secret,
  onPage,
}: {
  item: Item;
  secret: string;
  onPage: (page: Page) => void;
}) {
  const trpc = useTRPC();
  const input = useRef<HTMLInputElement>(null);
  const create = useMutation(
    trpc.upload.createUpload.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );
  const confirm = useMutation(
    trpc.upload.confirmUpload.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );
  const [busy, setBusy] = useState(false);
  const state = STATE[item.state];

  async function send(files: File[]) {
    setBusy(true);
    try {
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
        toast.success(`Thank you, ${item.label} received`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

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
      {item.state !== "done" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
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
              if (files.length) void send(files);
            }}
          />
          <Button
            icon="upload"
            variant={item.state === "received" ? "outline" : "primary"}
            pending={busy}
            className="w-full sm:w-auto"
            onClick={() => input.current?.click()}
          >
            {item.state === "received" ? "Add another file" : "Upload"}
          </Button>
          {item.files > 0 && (
            <span className="text-xs text-muted">
              {item.files} file{item.files > 1 ? "s" : ""} sent
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** What a client sees when they open the link their visa agent sent. */
export function ClientUploadPage() {
  const trpc = useTRPC();
  const [secret] = useState(secretFromUrl);
  const [page, setPage] = useState<Page | null>(null);
  const [agree, setAgree] = useState(false);
  const view = useMutation(
    trpc.upload.view.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );
  const accept = useMutation(
    trpc.upload.acceptPrivacyNotice.mutationOptions({ meta: { keepCache: true, quiet: true } }),
  );

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
        <ul className="flex flex-col gap-3">
          {page.items.map((item) => (
            <ItemCard key={item.id} item={item} secret={secret} onPage={setPage} />
          ))}
        </ul>
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
