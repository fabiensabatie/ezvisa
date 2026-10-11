import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CONVERSATION_STATUS } from "../components/ClientChatCard";
import { Button, INPUT } from "../components/controls";
import { Icon } from "../components/Icon";
import { Avatar, Card, Chip, Empty, Label, PageHeader, QueryView } from "../components/ui";
import { useCan } from "../lib/can";
import { fileSize, formatDate, timeAgo } from "../lib/format";
import { toast } from "../lib/toast";
import { stage, TONE } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";

type Status = "open" | "pending" | "resolved" | "all";
type Conversation = Outputs["chat"]["conversation"];
type Message = Conversation["messages"][number];

const TABS: Array<{ status: Status; label: string }> = [
  { status: "open", label: "With the team" },
  { status: "pending", label: "With agents" },
  { status: "resolved", label: "Resolved" },
  { status: "all", label: "All" },
];

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-extrabold text-ink hover:bg-bg"
    >
      {children} <Icon name="external" size={14} />
    </a>
  );
}

function ConversationList({ selected }: { selected: number | null }) {
  const trpc = useTRPC();
  const [status, setStatus] = useState<Status>("open");
  const [inboxId, setInboxId] = useState<number | undefined>(undefined);
  const inboxes = useQuery(trpc.chat.inboxes.queryOptions());
  const list = useQuery({
    ...trpc.chat.conversations.queryOptions({ status, inboxId, page: 1 }),
    refetchInterval: 10_000,
  });

  return (
    <Card className="flex min-h-0 flex-col p-0">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <div role="tablist" aria-label="Conversations" className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              type="button"
              role="tab"
              aria-selected={status === tab.status}
              onClick={() => setStatus(tab.status)}
              className={`min-h-9 rounded-full px-3 text-sm font-extrabold ${
                status === tab.status ? "bg-ink text-white" : "text-text-soft hover:bg-bg"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {(inboxes.data?.length ?? 0) > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Inbox</span>
            <select
              value={inboxId ?? ""}
              onChange={(e) => setInboxId(e.target.value ? Number(e.target.value) : undefined)}
              className={`h-10 w-full cursor-pointer ${INPUT}`}
            >
              <option value="">All inboxes</option>
              {inboxes.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {i.channel}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <QueryView query={list} what="the conversations">
        {(data) =>
          data.items.length === 0 ? (
            <div className="p-4">
              <Empty>
                {status === "open" ? "Nobody is waiting for the team." : "No conversations here."}
              </Empty>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {data.items.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/inbox/$conversationId"
                    params={{ conversationId: String(c.id) }}
                    className={`flex gap-3 px-3 py-3 hover:bg-bg ${selected === c.id ? "bg-soft" : ""}`}
                  >
                    <Avatar name={c.contactName ?? "?"} id={String(c.contactId)} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-extrabold">
                          {c.contactName ?? "Unknown"}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted">
                          {c.lastActivityAt ? timeAgo(c.lastActivityAt) : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        <span>{c.inbox ?? c.channel}</span>
                        {c.client && <span className="truncate">· {c.client.fullName}</span>}
                        {c.employee && <span className="truncate">· Team: {c.employee.name}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-sm text-text-soft">
                          {c.lastMessageFrom === "bot"
                            ? "Agent: "
                            : c.lastMessageFrom === "user"
                              ? "Team: "
                              : ""}
                          {c.lastMessage ?? "Attachment"}
                        </span>
                        {c.unread > 0 && (
                          <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-ink px-1.5 text-[11px] font-extrabold text-white">
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </Card>
  );
}

function Bubble({ m }: { m: Message }) {
  if (m.from === "activity") {
    return <li className="py-1 text-center text-xs text-muted">{m.text}</li>;
  }
  const mine = m.from !== "contact";
  const look = m.private
    ? "bg-[#FFF6DA] text-text"
    : m.from === "contact"
      ? "bg-white border border-line"
      : m.from === "agent"
        ? "bg-soft"
        : "bg-ink text-white";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%] ${look}`}>
        {(mine || m.private) && (
          <div className="mb-0.5 text-[11px] font-extrabold opacity-70">
            {m.private ? "Private note · " : ""}
            {m.from === "agent" ? `${m.author ?? "Agent"} (agent)` : (m.author ?? "Team")}
          </div>
        )}
        {m.text && <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>}
        {m.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {m.attachments.map((a, i) =>
              a.type === "image" && a.url ? (
                <a key={a.url ?? i} href={a.url} target="_blank" rel="noreferrer">
                  <img
                    src={a.thumbUrl ?? a.url}
                    alt="Sent in the chat"
                    className="max-h-48 rounded-xl border border-line object-cover"
                  />
                </a>
              ) : (
                <a
                  key={a.url ?? i}
                  href={a.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-bold text-ink underline"
                >
                  <Icon name="file" size={14} />
                  {a.type}
                  {a.extension ? `.${a.extension}` : ""}
                  {a.size ? ` · ${fileSize(a.size)}` : ""}
                </a>
              ),
            )}
          </div>
        )}
        <div className="mt-1 text-right text-[10px] opacity-60">{m.at ? timeAgo(m.at) : ""}</div>
      </div>
    </li>
  );
}

function Composer({ conversationId }: { conversationId: number }) {
  const trpc = useTRPC();
  const send = useMutation(trpc.chat.send.mutationOptions({ meta: { quiet: true } }));
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const submit = () => {
    if (!text.trim()) return;
    send.mutate({ conversationId, text, private: note }, { onSuccess: () => setText("") });
  };
  return (
    <form
      className={`border-t border-line p-3 ${note ? "bg-[#FFF6DA]" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="reply" className="sr-only">
        {note ? "Private note" : "Reply"}
      </label>
      <textarea
        id="reply"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={
          note
            ? "A note only the team sees"
            : "Reply to the client. The agent stops answering this conversation."
        }
        className={`w-full p-3 text-sm ${INPUT}`}
      />
      {send.error && (
        <p role="alert" className="mt-1 text-sm font-bold text-[#A32A2A]">
          {errorMessage(send.error)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={note}
            onChange={(e) => setNote(e.target.checked)}
            className="size-4 accent-[var(--ezv-ink)]"
          />
          Private note
        </label>
        <span className="hidden text-xs text-muted sm:inline">Ctrl or ⌘ + Enter to send</span>
        <Button
          type="submit"
          icon="send"
          pending={send.isPending}
          disabled={!text.trim()}
          className="ml-auto"
        >
          {note ? "Add note" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function LinkClient({ conversationId }: { conversationId: number }) {
  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const results = useQuery({
    ...trpc.clients.list.queryOptions({ search: search.trim() || undefined, limit: 6 }),
    enabled: search.trim().length >= 2,
  });
  const link = useMutation(trpc.chat.link.mutationOptions());
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="client-search" className="text-sm font-extrabold">
        Link to a client
      </label>
      <input
        id="client-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Name, phone or passport"
        className={`h-11 ${INPUT}`}
      />
      {results.data?.items.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={link.isPending}
          onClick={() =>
            link.mutate(
              { conversationId, clientId: c.id },
              { onSuccess: () => toast.success(`Linked to ${c.fullName}`) },
            )
          }
          className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line px-3 text-left text-sm hover:bg-bg"
        >
          <span className="font-bold">{c.fullName}</span>
          <span className="text-xs text-muted">Link</span>
        </button>
      ))}
      <p className="text-xs text-muted">
        Only once you are sure who is writing. Client agents can then work on that client's records.
      </p>
    </div>
  );
}

function LinkTeamMember({ conversationId }: { conversationId: number }) {
  const trpc = useTRPC();
  const employees = useQuery(trpc.team.employees.queryOptions({ includeInactive: false }));
  const link = useMutation(trpc.chat.linkTeamMember.mutationOptions());
  const people = employees.data?.items.filter((e) => e.kind === "HUMAN") ?? [];
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-extrabold">Or a team member</span>
      <select
        value=""
        disabled={link.isPending}
        onChange={(e) =>
          e.target.value &&
          link.mutate(
            { conversationId, employeeId: e.target.value },
            { onSuccess: () => toast.success("Team agents will answer this person") },
          )
        }
        className={`h-11 cursor-pointer ${INPUT}`}
      >
        <option value="">Choose…</option>
        {people.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.role.name})
          </option>
        ))}
      </select>
    </label>
  );
}

function PersonPanel({ c }: { c: Conversation }) {
  const trpc = useTRPC();
  const { can } = useCan();
  const unlink = useMutation(trpc.chat.unlink.mutationOptions());
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <Label>Contact</Label>
        <div className="mt-1 font-extrabold">{c.contact.name ?? "Unknown"}</div>
        <div className="text-sm text-muted">
          {[c.contact.phone, c.contact.email, c.inbox ?? c.channel].filter(Boolean).join(" · ")}
        </div>
      </div>
      {c.client ? (
        <div className="flex flex-col gap-2">
          <Label>Client</Label>
          <Link
            to="/clients/$clientId"
            params={{ clientId: c.client.id }}
            className="font-extrabold text-ink underline"
          >
            {c.client.fullName}
          </Link>
          <span className="text-xs text-muted">Linked by the {c.client.linkedBy}</span>
          {c.client.cases.length === 0 ? (
            <span className="text-sm text-muted">No open case.</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {c.client.cases.map((k) => {
                const s = stage(k.stage);
                return (
                  <li key={k.number}>
                    <Link
                      to="/cases/$number"
                      params={{ number: k.number }}
                      className="flex flex-wrap items-center gap-2 rounded-2xl border border-line px-3 py-2 text-sm hover:bg-bg"
                    >
                      <span className="font-mono text-xs text-muted">{k.number}</span>
                      <span className="min-w-0 flex-1 truncate font-bold">{k.template}</span>
                      <Chip tone={s.tone}>{s.label}</Chip>
                      <span className="w-full text-xs text-muted">
                        {k.missing > 0 ? `${k.missing} still needed` : "Nothing missing"}
                        {k.received > 0 ? ` · ${k.received} to check` : ""}
                        {k.dueDate ? ` · due ${formatDate(k.dueDate)}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {can("clients", "edit") && (
            <Button
              variant="ghost"
              className="self-start"
              pending={unlink.isPending}
              onClick={() => unlink.mutate({ contactId: c.contact.id, what: "client" })}
            >
              Unlink client
            </Button>
          )}
        </div>
      ) : c.employee ? (
        <div className="flex flex-col gap-1">
          <Label>Team member</Label>
          <span className="font-extrabold">{c.employee.name}</span>
          <span className="text-xs text-muted">
            Team agents answer them with their permissions.
          </span>
          {can("team", "full") && (
            <Button
              variant="ghost"
              className="self-start"
              pending={unlink.isPending}
              onClick={() => unlink.mutate({ contactId: c.contact.id, what: "employee" })}
            >
              Unlink
            </Button>
          )}
        </div>
      ) : (
        can("clients", "edit") && (
          <div className="flex flex-col gap-4">
            <LinkClient conversationId={c.id} />
            {can("team", "full") && <LinkTeamMember conversationId={c.id} />}
          </div>
        )
      )}
      <div className="flex flex-wrap">
        <ExternalLink href={c.chatwootUrl}>Open in Chatwoot</ExternalLink>
      </div>
    </Card>
  );
}

function ConversationView({ id }: { id: number }) {
  const trpc = useTRPC();
  const { can } = useCan();
  const conversation = useQuery({
    ...trpc.chat.conversation.queryOptions({ conversationId: id }),
    refetchInterval: 5_000,
  });
  const markRead = useMutation(
    trpc.chat.markRead.mutationOptions({ meta: { quiet: true, keepCache: true } }),
  );
  const hand = useMutation(trpc.chat.hand.mutationOptions());
  const end = useRef<HTMLDivElement>(null);
  const count = conversation.data?.messages.length ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: mark read once per conversation opened.
  useEffect(() => {
    markRead.mutate({ conversationId: id });
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages arrive.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count, id]);

  return (
    <QueryView query={conversation} what="this conversation">
      {(c) => {
        const status = CONVERSATION_STATUS[c.status] ?? { label: c.status, tone: "mute" as const };
        return (
          <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <Card className="flex min-h-[60vh] flex-col p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
                <Link
                  to="/inbox"
                  className="rounded-full p-2 hover:bg-bg lg:hidden"
                  aria-label="Back to the conversations"
                >
                  <Icon name="arrowLeft" size={18} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-extrabold">{c.contact.name ?? "Unknown"}</div>
                  <div className="text-xs text-muted">{c.inbox ?? c.channel}</div>
                </div>
                <Chip tone={status.tone}>{status.label}</Chip>
                {can("clients", "edit") && (
                  <span className="flex flex-wrap gap-1.5">
                    {c.status === "pending" ? (
                      <Button
                        variant="outline"
                        pending={hand.isPending}
                        onClick={() => hand.mutate({ conversationId: c.id, to: "team" })}
                      >
                        Take over
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        pending={hand.isPending}
                        onClick={() => hand.mutate({ conversationId: c.id, to: "agent" })}
                      >
                        Hand to agent
                      </Button>
                    )}
                    {c.status !== "resolved" && (
                      <Button
                        variant="ghost"
                        icon="check"
                        pending={hand.isPending}
                        onClick={() => hand.mutate({ conversationId: c.id, to: "resolved" })}
                      >
                        Resolve
                      </Button>
                    )}
                  </span>
                )}
              </div>
              <ul
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-bg/50 p-3"
                aria-live="polite"
              >
                {c.messages.length === 0 && (
                  <li className="text-center text-sm text-muted">No messages yet.</li>
                )}
                {c.messages.map((m) => (
                  <Bubble key={m.id} m={m} />
                ))}
                <div ref={end} />
              </ul>
              {can("clients", "edit") && <Composer conversationId={c.id} />}
            </Card>
            <PersonPanel c={c} />
          </div>
        );
      }}
    </QueryView>
  );
}

/** Every conversation from Chatwoot's channels, with who is writing and their cases. */
export function InboxPage() {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const selected = params.conversationId ? Number(params.conversationId) : null;
  const trpc = useTRPC();
  const overview = useQuery(trpc.chat.inboxes.queryOptions());

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="LINE, Messenger and WhatsApp in one place. Agents answer first; conversations they hand over wait under “With the team”."
      >
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-extrabold hover:bg-bg"
        >
          <Icon name="sparkle" size={16} /> Agents
        </Link>
      </PageHeader>
      {overview.error ? (
        <Card>
          <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
            <Icon name="alert" size={17} className="mt-px shrink-0" />
            {errorMessage(overview.error)}
          </p>
        </Card>
      ) : (
        <div className="grid min-h-0 items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className={selected ? "hidden lg:block" : ""}>
            <ConversationList selected={selected} />
          </div>
          <div className={selected ? "" : "hidden lg:block"}>
            {selected ? (
              <ConversationView key={selected} id={selected} />
            ) : (
              <Card>
                <Empty>Pick a conversation.</Empty>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
