import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCan } from "../lib/can";
import { timeAgo } from "../lib/format";
import { toast } from "../lib/toast";
import type { Tone } from "../lib/tones";
import { useTRPC } from "../trpc";
import { Button, Dialog } from "./controls";
import { Icon } from "./Icon";
import { Card, CardTitle, Chip, Empty, QueryView } from "./ui";

export const CONVERSATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "With an agent", tone: "info" },
  open: { label: "With the team", tone: "warn" },
  resolved: { label: "Resolved", tone: "ok" },
  snoozed: { label: "Snoozed", tone: "mute" },
};

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
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

function LinkDialog({
  clientId,
  name,
  onClose,
}: {
  clientId: string;
  name: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const conversations = useQuery(trpc.chat.conversations.queryOptions({ status: "all" }));
  const link = useMutation(trpc.chat.link.mutationOptions());
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Link a conversation to ${name}`}
      description="Only once you are sure who is writing. Client agents can then work on their cases with them and send their upload links."
    >
      <QueryView query={conversations} what="conversations">
        {(data) =>
          data.items.length === 0 ? (
            <Empty>No conversations in the shared inbox yet.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.items.map((c) => {
                const mine = c.client?.id === clientId;
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="font-bold">
                        {c.contactName ?? "Unknown"}{" "}
                        <span className="text-muted">· {c.channel}</span>
                      </div>
                      <div className="truncate text-sm text-muted">
                        {c.lastMessage ?? "No message"}
                        {c.lastActivityAt && ` · ${timeAgo(c.lastActivityAt)}`}
                      </div>
                      {c.client && !mine && (
                        <div className="text-xs font-bold text-[#8A5700]">
                          Linked to {c.client.fullName}: linking moves it here.
                        </div>
                      )}
                    </div>
                    {mine ? (
                      <Chip tone="ok">Linked</Chip>
                    ) : (
                      <Button
                        variant="outline"
                        pending={link.isPending && link.variables?.conversationId === c.id}
                        onClick={() =>
                          link.mutate(
                            { conversationId: c.id, clientId },
                            {
                              onSuccess: () => {
                                toast.success("Conversation linked");
                                onClose();
                              },
                            },
                          )
                        }
                      >
                        Link
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryView>
    </Dialog>
  );
}

/** The client's conversations in the shared inbox. Hidden when Chatwoot is not connected. */
export function ClientChatCard({ clientId, name }: { clientId: string; name: string }) {
  const trpc = useTRPC();
  const { can } = useCan();
  const chats = useQuery(trpc.chat.clientChats.queryOptions({ clientId }));
  const unlink = useMutation(trpc.chat.unlink.mutationOptions());
  const [linking, setLinking] = useState(false);
  if (chats.data && !chats.data.connected) return null;

  return (
    <Card>
      <CardTitle
        icon={{ name: "message" }}
        aside={
          can("clients", "edit") && (
            <Button variant="soft" icon="plus" onClick={() => setLinking(true)}>
              Link a conversation
            </Button>
          )
        }
      >
        Chat
      </CardTitle>
      <QueryView query={chats} what="conversations">
        {(data) =>
          data.contacts.length === 0 ? (
            <Empty>
              No conversation linked. A client agent links one itself when the client confirms their
              name and date of birth in the chat.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.contacts.map((contact) => (
                <li key={contact.contactId} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">{contact.name ?? "Unknown"}</span>
                    <Chip>{contact.channel}</Chip>
                    <span className="text-xs text-muted">
                      linked by the {contact.linkedBy}
                      {contact.linkedAt && ` · ${timeAgo(contact.linkedAt)}`}
                    </span>
                    <span className="ml-auto flex flex-wrap items-center">
                      <ExternalLink href={contact.chatwootUrl}>Chatwoot</ExternalLink>
                      {can("clients", "edit") && (
                        <Button
                          variant="ghost"
                          pending={
                            unlink.isPending && unlink.variables?.contactId === contact.contactId
                          }
                          onClick={() =>
                            unlink.mutate(
                              { contactId: contact.contactId },
                              { onSuccess: () => toast.success("Unlinked") },
                            )
                          }
                        >
                          Unlink
                        </Button>
                      )}
                    </span>
                  </div>
                  {contact.conversations.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {contact.conversations.map((conv) => {
                        const status = CONVERSATION_STATUS[conv.status] ?? {
                          label: conv.status,
                          tone: "mute" as const,
                        };
                        return (
                          <li key={conv.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <Chip tone={status.tone}>{status.label}</Chip>
                            <span className="min-w-0 flex-1 truncate text-muted">
                              {conv.lastMessage ?? `Conversation ${conv.id}`}
                            </span>
                            <Link
                              to="/inbox/$conversationId"
                              params={{ conversationId: String(conv.id) }}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-extrabold text-ink hover:bg-bg"
                            >
                              Open <Icon name="arrowRight" size={14} />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      {linking && <LinkDialog clientId={clientId} name={name} onClose={() => setLinking(false)} />}
    </Card>
  );
}
