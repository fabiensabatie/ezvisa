import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { formatInstant } from "../lib/format";
import { toast } from "../lib/toast";
import { ITEM_STATUS, TONE } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";
import { Button, Dialog, INPUT, SelectField, TextAreaField } from "./controls";
import { Icon } from "./Icon";
import { Chip } from "./ui";

type CaseDetail = Outputs["cases"]["get"];
type Shared = Outputs["cases"]["shareUploadLink"];

const LIFETIMES = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "1 month" },
];

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Copy failed. Select the text and copy it by hand.");
  }
}

/**
 * Shares the client's part of the checklist: a private page where the client uploads
 * what is asked of them. The link is shown once; sharing again replaces it.
 */
export function ShareChecklistDialog({ c, onClose }: { c: CaseDetail; onClose: () => void }) {
  const trpc = useTRPC();
  const share = useMutation(trpc.cases.shareUploadLink.mutationOptions({ meta: { quiet: true } }));
  const revoke = useMutation(trpc.cases.revokeUploadLink.mutationOptions());
  const [days, setDays] = useState("14");
  const [shared, setShared] = useState<Shared | null>(null);
  const [message, setMessage] = useState("");
  const asked = c.items.filter((i) => i.clientUpload);
  const current =
    c.uploadLink?.expiresAt && Date.parse(c.uploadLink.expiresAt) > Date.now()
      ? c.uploadLink
      : null;

  async function create() {
    const result = await share
      .mutateAsync({ case: c.number, expiresInDays: Number(days) })
      .catch(() => null);
    if (result) {
      setShared(result);
      setMessage(result.message);
    }
  }

  if (shared) {
    return (
      <Dialog
        open
        wide
        onClose={onClose}
        title="Send this to the client"
        description={`Works until ${formatInstant(shared.expiresAt)}. It is shown only now: copy it before closing.`}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="share-link" className="text-sm font-extrabold">
              Link
            </label>
            <div className="flex gap-2">
              <input
                id="share-link"
                readOnly
                value={shared.url}
                onFocus={(e) => e.target.select()}
                className={`h-11 min-w-0 flex-1 font-mono text-xs ${INPUT}`}
              />
              <Button variant="outline" icon="copy" onClick={() => copy(shared.url, "Link")}>
                Copy
              </Button>
            </div>
          </div>
          <TextAreaField
            label="Message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            hint="Paste it into the client's chat. Edit it if you like."
          />
          <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.info}`}>
            <Icon name="key" size={17} className="mt-px" />
            Whoever has this link can upload to this case until it expires. They cannot see or
            download any document. Sharing again replaces it.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" icon="copy" onClick={() => copy(message, "Message")}>
              Copy message
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Share the checklist with the client"
      description="The client gets a private page to upload these, without an account. Each upload arrives here as received, for the team to check."
    >
      <div className="flex flex-col gap-4">
        <ul className="divide-y divide-line rounded-2xl border border-line px-3.5">
          {asked.map((i) => {
            const status = ITEM_STATUS[i.status] ?? { label: i.status, tone: "mute" as const };
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="font-bold">{i.label}</span>
                <Chip tone={status.tone}>{status.label}</Chip>
              </li>
            );
          })}
        </ul>
        {current && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-bg px-3.5 py-3 text-sm">
            <span className="min-w-0 flex-1 basis-56 text-text-soft">
              A link shared {formatInstant(current.createdAt)} works until{" "}
              {formatInstant(current.expiresAt)}. {current.uploads} file
              {current.uploads === 1 ? "" : "s"} received through it.
            </span>
            <Button
              variant="danger"
              pending={revoke.isPending}
              onClick={() =>
                revoke.mutate(
                  { case: c.number },
                  { onSuccess: () => toast.success("The link no longer works") },
                )
              }
            >
              Stop that link
            </Button>
          </div>
        )}
        <SelectField
          label="The link works for"
          options={LIFETIMES}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        {share.error && (
          <p
            role="alert"
            className="rounded-2xl bg-[#FFF5F5] px-3.5 py-3 text-sm font-bold text-[#A32A2A]"
          >
            {errorMessage(share.error)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="send" pending={share.isPending} onClick={create}>
            {current ? "Create a new link" : "Create the link"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
