import { z } from "zod";
import { audit } from "../audit.js";
import {
  type ChatConnection,
  type ChatwootConversation,
  ChatwootError,
  channelName,
  contactUrl,
  conversationUrl,
  MESSAGE_TYPE,
  senderKind,
} from "../chat/chatwoot.js";
import {
  clientPageUrl,
  readChatSettings,
  showClientInChatwoot,
  writeChatSettings,
} from "../chat/setup.js";
import { type Context, requireLevel } from "../context.js";
import { formatDateOnly } from "../dates.js";
import { DomainError } from "../errors.js";
import { hasLevel } from "../permissions.js";
import { caseNumber, id } from "../refs.js";

function requireChat(ctx: Context): ChatConnection {
  if (!ctx.chat) {
    throw new DomainError(
      "CONFLICT",
      "The shared inbox is not connected. Set CHATWOOT_URL and CHATWOOT_API_TOKEN on the server.",
    );
  }
  return ctx.chat;
}

/** Chatwoot being down or refusing the token is a conflict to explain, not a crash. */
async function inChatwoot<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ChatwootError) {
      throw new DomainError(
        error.status === 401 || error.status === 403 ? "FORBIDDEN" : "CONFLICT",
        error.status === 401
          ? "Chatwoot refused the access token. Check CHATWOOT_API_TOKEN on the server."
          : error.status === 404
            ? "Chatwoot has no such conversation."
            : `Chatwoot could not do that (${error.status}).`,
      );
    }
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "TypeError")) {
      throw new DomainError("CONFLICT", "Chatwoot did not answer. Try again in a minute.");
    }
    throw error;
  }
}

const iso = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toISOString() : null;

function conversationSummary(
  chat: ChatConnection,
  c: ChatwootConversation,
  inboxNames: Map<number, string> = new Map(),
) {
  const last = c.messages?.at(-1);
  return {
    id: c.id,
    status: c.status,
    channel: channelName(c.meta.channel),
    inbox: inboxNames.get(c.inbox_id) ?? null,
    contactId: c.meta.sender.id,
    contactName: c.meta.sender.name ?? null,
    contactThumbnail: c.meta.sender.thumbnail || null,
    lastMessage: last?.content?.slice(0, 160) ?? null,
    lastMessageFrom: last ? (senderKind(last) ?? null) : null,
    lastActivityAt: iso(c.last_activity_at),
    unread: c.unread_count ?? 0,
    chatwootUrl: conversationUrl(chat, c.id),
  };
}

async function inboxNames(chat: ChatConnection) {
  return new Map((await chat.api.inboxes()).map((i) => [i.id, i.name]));
}

// ---- settings shared by every agent (owner) --------------------------------------------------

/** The connection to Chatwoot, the notes every agent reads, the pause switch and usage. */
export async function chatOverview(ctx: Context) {
  requireLevel(ctx, "settings", "view");
  const settings = await readChatSettings(ctx.db);
  const month = new Date(ctx.now());
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const rows = await ctx.db.auditLog.findMany({
    where: { via: "CHAT", action: { in: ["chat.replied", "chat.handed_off"] }, at: { gte: month } },
    select: { action: true, after: true },
  });
  const tokens = { input: 0, output: 0, cacheRead: 0 };
  for (const row of rows) {
    const t = (row.after as { tokens?: Partial<typeof tokens> } | null)?.tokens;
    tokens.input += t?.input ?? 0;
    tokens.output += t?.output ?? 0;
    tokens.cacheRead += t?.cacheRead ?? 0;
  }
  let connection: { connected: boolean; url: string | null; error: string | null } = {
    connected: false,
    url: null,
    error: null,
  };
  if (ctx.chat) {
    try {
      await ctx.chat.api.inboxes();
      connection = { connected: true, url: ctx.chat.publicUrl, error: null };
    } catch (error) {
      connection = {
        connected: false,
        url: ctx.chat.publicUrl,
        error:
          error instanceof ChatwootError && error.status === 401
            ? "Chatwoot refused the access token. Check CHATWOOT_API_TOKEN."
            : "Chatwoot did not answer.",
      };
    }
  }
  return {
    connection,
    enabled: settings.enabled,
    instructions: settings.instructions,
    modelReady: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    usage: {
      replies: rows.filter((r) => r.action === "chat.replied").length,
      handOffs: rows.filter((r) => r.action === "chat.handed_off").length,
      tokens,
    },
  };
}

export const updateChatSettingsInput = z.object({
  enabled: z.boolean().optional().describe("Off pauses every agent"),
  instructions: z
    .string()
    .max(8000)
    .optional()
    .describe("What every agent should know: opening hours, prices, address, policies"),
});

export async function updateChatSettings(
  ctx: Context,
  raw: z.input<typeof updateChatSettingsInput>,
) {
  requireLevel(ctx, "settings", "edit");
  const input = updateChatSettingsInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const before = await readChatSettings(tx);
    const after = {
      enabled: input.enabled ?? before.enabled,
      instructions: input.instructions?.trim() ?? before.instructions,
    };
    await writeChatSettings(tx, after);
    await audit(tx, ctx, {
      action: "chat.settings_updated",
      entity: "Setting",
      entityId: "chat.assistant",
      before,
      after,
    });
    return after;
  });
}

// ---- the inbox (team) -----------------------------------------------------------------------

/** The inboxes (LINE, Messenger, WhatsApp…), for filtering conversations. */
export async function chatInboxes(ctx: Context) {
  requireLevel(ctx, "clients", "view");
  const chat = requireChat(ctx);
  const inboxes = await inChatwoot(() => chat.api.inboxes());
  return inboxes.map((i) => ({ id: i.id, name: i.name, channel: channelName(i.channel_type) }));
}

/** Conversations waiting for a person, for the navigation badge. Null when it cannot tell. */
export async function waitingConversations(ctx: Context): Promise<number | null> {
  if (!ctx.chat || !hasLevel(ctx.actor.permissions, "clients", "view")) return null;
  try {
    return (await ctx.chat.api.conversations({ status: "open", page: 1 })).total;
  } catch {
    return null;
  }
}

export const listConversationsInput = z.object({
  status: z
    .enum(["open", "pending", "resolved", "all"])
    .default("open")
    .describe("open: with the team; pending: with an agent; resolved: done"),
  inboxId: z.number().int().positive().optional().describe("Only this inbox"),
  page: z.number().int().min(1).default(1).describe("25 per page"),
});

/** Conversations in the shared inbox, newest activity first, with who each person is in EzVisa. */
export async function listConversations(ctx: Context, raw: z.input<typeof listConversationsInput>) {
  requireLevel(ctx, "clients", "view");
  const input = listConversationsInput.parse(raw);
  const chat = requireChat(ctx);
  const [page, names] = await inChatwoot(() =>
    Promise.all([chat.api.conversations(input), inboxNames(chat)]),
  );
  const contacts = await ctx.db.chatContact.findMany({
    where: { chatwootId: { in: page.items.map((c) => c.meta.sender.id) } },
    include: {
      client: { select: { id: true, fullName: true } },
      employee: { select: { id: true, name: true } },
    },
  });
  const byContact = new Map(contacts.map((c) => [c.chatwootId, c]));
  return {
    items: page.items.map((c) => ({
      ...conversationSummary(chat, c, names),
      client: byContact.get(c.meta.sender.id)?.client ?? null,
      employee: byContact.get(c.meta.sender.id)?.employee ?? null,
    })),
    total: page.total,
    page: input.page,
  };
}

export const getConversationInput = z.object({
  conversationId: z.number().int().positive().describe("The conversation number in Chatwoot"),
});

/**
 * A conversation in full: its latest messages with attachments, who is writing, and, when
 * they are a client, their open cases and what is still missing.
 */
export async function getConversation(ctx: Context, raw: z.input<typeof getConversationInput>) {
  requireLevel(ctx, "clients", "view");
  const { conversationId } = getConversationInput.parse(raw);
  const chat = requireChat(ctx);
  const conversation = await inChatwoot(() => chat.api.conversation(conversationId));
  if (!conversation) {
    throw new DomainError("NOT_FOUND", `No conversation ${conversationId} in Chatwoot.`);
  }
  const [messages, names] = await inChatwoot(() =>
    Promise.all([chat.api.messages(conversationId), inboxNames(chat)]),
  );
  const sender = conversation.meta.sender;
  const contact = await ctx.db.chatContact.findUnique({
    where: { chatwootId: sender.id },
    include: { employee: { select: { id: true, name: true } } },
  });
  const client = contact?.clientId
    ? await ctx.db.client.findFirst({
        where: { id: contact.clientId, deletedAt: null },
        include: {
          cases: {
            where: { stage: { notIn: ["DONE", "CANCELLED"] } },
            include: { items: true, templateVersion: { include: { template: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;
  const agents = await ctx.db.agent.findMany({ select: { name: true, chatwootBotId: true } });
  return {
    ...conversationSummary(chat, conversation, names),
    contact: {
      id: sender.id,
      name: sender.name ?? null,
      phone: sender.phone_number || null,
      email: sender.email || null,
      chatwootUrl: contactUrl(chat, sender.id),
    },
    client: client
      ? {
          id: client.id,
          fullName: client.fullName,
          linkedBy: contact?.linkedById ? "team" : "agent",
          cases: client.cases.map((c) => ({
            number: caseNumber(c.number),
            template: c.templateVersion.template.name,
            stage: c.stage,
            dueDate: c.dueDate ? formatDateOnly(c.dueDate) : null,
            missing: c.items.filter((i) => i.status === "MISSING" || i.status === "FLAGGED").length,
            received: c.items.filter((i) => i.status === "RECEIVED").length,
          })),
        }
      : null,
    employee: contact?.employee ?? null,
    messages: messages
      .filter((m) => m.message_type !== MESSAGE_TYPE.activity || m.content)
      .map((m) => {
        const kind = senderKind(m);
        return {
          id: m.id,
          at: iso(m.created_at),
          from:
            m.message_type === MESSAGE_TYPE.activity
              ? ("activity" as const)
              : m.message_type === MESSAGE_TYPE.incoming
                ? ("contact" as const)
                : kind === "bot"
                  ? ("agent" as const)
                  : ("team" as const),
          author:
            kind === "bot"
              ? (agents.find((a) => a.chatwootBotId === m.sender?.id)?.name ??
                m.sender?.name ??
                "Agent")
              : (m.sender?.name ?? null),
          private: m.private,
          text: m.content ?? "",
          attachments: (m.attachments ?? []).map((a) => ({
            type: a.file_type ?? "file",
            url: a.data_url ?? null,
            thumbUrl: a.thumb_url || null,
            size: a.file_size ?? null,
            extension: a.extension ?? null,
          })),
        };
      }),
  };
}

/** Marks a conversation read in Chatwoot, as opening it there would. */
export async function markConversationRead(
  ctx: Context,
  raw: z.input<typeof getConversationInput>,
) {
  requireLevel(ctx, "clients", "view");
  const { conversationId } = getConversationInput.parse(raw);
  const chat = requireChat(ctx);
  await inChatwoot(() => chat.api.markRead(conversationId));
  return { conversationId };
}

export const sendChatMessageInput = z
  .object({
    conversationId: z.number().int().positive().optional().describe("The conversation to write in"),
    clientId: id("Client")
      .optional()
      .describe("Or the client: writes in their most recent conversation"),
    text: z.string().trim().min(1).max(4000),
    private: z
      .boolean()
      .default(false)
      .describe("A note only the team sees, not sent to the client"),
  })
  .refine((v) => (v.conversationId === undefined) !== (v.clientId === undefined), {
    message: "Give either conversationId or clientId.",
  });

/** The client's most recent conversation, from the chat contacts linked to them. */
async function latestConversationOf(ctx: Context, chat: ChatConnection, clientId: string) {
  const contacts = await ctx.db.chatContact.findMany({ where: { clientId } });
  if (contacts.length === 0) {
    throw new DomainError(
      "CONFLICT",
      "This client has no conversation linked yet. Link one from the inbox, or wait until they write.",
    );
  }
  const all = (
    await inChatwoot(() =>
      Promise.all(contacts.map((c) => chat.api.contactConversations(c.chatwootId))),
    )
  ).flat();
  const latest = all.sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0))[0];
  if (!latest) throw new DomainError("CONFLICT", "This client has no conversation in Chatwoot.");
  return latest;
}

/**
 * Writes in a conversation as the team. A message to the client takes the conversation from
 * the agent ("open"); a private note does not. On WhatsApp a message only reaches the client
 * within 24 hours of their last one.
 */
export async function sendChatMessage(ctx: Context, raw: z.input<typeof sendChatMessageInput>) {
  requireLevel(ctx, "clients", "edit");
  const input = sendChatMessageInput.parse(raw);
  const chat = requireChat(ctx);
  const conversationId =
    input.conversationId ?? (await latestConversationOf(ctx, chat, input.clientId as string)).id;
  const message = await inChatwoot(async () => {
    const sent = await chat.api.sendMessage(conversationId, {
      content: input.text,
      private: input.private,
    });
    if (!input.private) await chat.api.setStatus(conversationId, "open");
    return sent;
  });
  await audit(ctx.db, ctx, {
    action: input.private ? "chat.note_added" : "chat.message_sent",
    entity: "Conversation",
    entityId: String(conversationId),
    after: { messageId: message.id, length: input.text.length },
  });
  return { conversationId, messageId: message.id };
}

export const linkChatContactInput = z.object({
  conversationId: z.number().int().positive().describe("A conversation of the person to link"),
  clientId: id("Client"),
});

async function conversationSender(chat: ChatConnection, conversationId: number) {
  const conversation = await inChatwoot(() => chat.api.conversation(conversationId));
  if (!conversation)
    throw new DomainError("NOT_FOUND", `No conversation ${conversationId} in Chatwoot.`);
  return conversation;
}

/**
 * Links the person writing in a conversation to a client, once someone has confirmed who
 * they are. Client agents can then work on that client's records with them.
 */
export async function linkChatContact(ctx: Context, raw: z.input<typeof linkChatContactInput>) {
  requireLevel(ctx, "clients", "edit");
  const input = linkChatContactInput.parse(raw);
  const chat = requireChat(ctx);
  const conversation = await conversationSender(chat, input.conversationId);
  const client = await ctx.db.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
  if (!client) throw new DomainError("NOT_FOUND", "No such client.");
  const sender = conversation.meta.sender;
  const result = await ctx.db.$transaction(async (tx) => {
    const before = await tx.chatContact.findUnique({ where: { chatwootId: sender.id } });
    const data = {
      clientId: client.id,
      linkedAt: ctx.now(),
      linkedById: ctx.actor.employeeId,
      failedChecks: 0,
    };
    await tx.chatContact.upsert({
      where: { chatwootId: sender.id },
      update: data,
      create: {
        chatwootId: sender.id,
        name: sender.name ?? null,
        channel: conversation.meta.channel ?? null,
        ...data,
      },
    });
    await audit(tx, ctx, {
      action: "chat.contact_linked",
      entity: "Client",
      entityId: client.id,
      before: before?.clientId ? { clientId: before.clientId } : undefined,
      after: { chatwootContactId: sender.id, by: "a person" },
    });
    return { contactId: sender.id, clientId: client.id, fullName: client.fullName };
  });
  await showClientInChatwoot(chat, sender.id, clientPageUrl(ctx.appUrl, client.id));
  return result;
}

export const linkTeamMemberInput = z.object({
  conversationId: z.number().int().positive().describe("A conversation of the person to link"),
  employeeId: id("Employee"),
});

/**
 * Records that the person writing is someone on the team, so team agents answer them, with
 * no more than that person's own permissions. Owners only.
 */
export async function linkTeamMember(ctx: Context, raw: z.input<typeof linkTeamMemberInput>) {
  requireLevel(ctx, "team", "full");
  const input = linkTeamMemberInput.parse(raw);
  const chat = requireChat(ctx);
  const conversation = await conversationSender(chat, input.conversationId);
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee?.active || employee.kind !== "HUMAN") {
    throw new DomainError("CONFLICT", "Only an active person on the team can be linked.");
  }
  const sender = conversation.meta.sender;
  await ctx.db.$transaction(async (tx) => {
    await tx.chatContact.upsert({
      where: { chatwootId: sender.id },
      update: { employeeId: employee.id },
      create: {
        chatwootId: sender.id,
        name: sender.name ?? null,
        channel: conversation.meta.channel ?? null,
        employeeId: employee.id,
      },
    });
    await audit(tx, ctx, {
      action: "chat.team_member_linked",
      entity: "Employee",
      entityId: employee.id,
      after: { chatwootContactId: sender.id },
    });
  });
  return { contactId: sender.id, employeeId: employee.id, name: employee.name };
}

export const unlinkChatContactInput = z.object({
  contactId: z.number().int().positive().describe("The contact's id in Chatwoot"),
  what: z.enum(["client", "employee"]).default("client"),
});

export async function unlinkChatContact(ctx: Context, raw: z.input<typeof unlinkChatContactInput>) {
  const { contactId, what } = unlinkChatContactInput.parse(raw);
  requireLevel(ctx, what === "client" ? "clients" : "team", what === "client" ? "edit" : "full");
  const contact = await ctx.db.chatContact.findUnique({ where: { chatwootId: contactId } });
  const linked = what === "client" ? contact?.clientId : contact?.employeeId;
  if (!contact || !linked) return { contactId, unlinked: false };
  await ctx.db.$transaction(async (tx) => {
    await tx.chatContact.update({
      where: { id: contact.id },
      data:
        what === "client"
          ? { clientId: null, linkedAt: null, linkedById: null }
          : { employeeId: null },
    });
    await audit(tx, ctx, {
      action: what === "client" ? "chat.contact_unlinked" : "chat.team_member_unlinked",
      entity: what === "client" ? "Client" : "Employee",
      entityId: linked,
      after: { chatwootContactId: contactId },
    });
  });
  if (what === "client" && ctx.chat) await showClientInChatwoot(ctx.chat, contactId, null);
  return { contactId, unlinked: true };
}

export const handConversationInput = z.object({
  conversationId: z.number().int().positive(),
  to: z
    .enum(["agent", "team", "resolved"])
    .describe("agent: the inbox's agent answers again; team: a person takes over; resolved: done"),
});

export async function handConversation(ctx: Context, raw: z.input<typeof handConversationInput>) {
  requireLevel(ctx, "clients", "edit");
  const input = handConversationInput.parse(raw);
  const chat = requireChat(ctx);
  const status = input.to === "agent" ? "pending" : input.to === "team" ? "open" : "resolved";
  await inChatwoot(() => chat.api.setStatus(input.conversationId, status));
  await audit(ctx.db, ctx, {
    action:
      input.to === "agent"
        ? "chat.handed_to_agent"
        : input.to === "team"
          ? "chat.taken_over"
          : "chat.resolved",
    entity: "Conversation",
    entityId: String(input.conversationId),
  });
  return { conversationId: input.conversationId, status };
}

export const clientChatsInput = z.object({ clientId: id("Client") });

/** The client's chat contacts and their conversations, for the client page. */
export async function clientChats(ctx: Context, raw: z.input<typeof clientChatsInput>) {
  requireLevel(ctx, "clients", "view");
  const { clientId } = clientChatsInput.parse(raw);
  const contacts = await ctx.db.chatContact.findMany({
    where: { clientId },
    orderBy: { linkedAt: "asc" },
  });
  const chat = ctx.chat;
  if (!chat) return { connected: false, contacts: [] };
  const conversations = await Promise.all(
    contacts.map((c) => chat.api.contactConversations(c.chatwootId).catch(() => [])),
  );
  return {
    connected: true,
    contacts: contacts.map((c, index) => ({
      contactId: c.chatwootId,
      name: c.name,
      channel: channelName(c.channel),
      linkedAt: c.linkedAt?.toISOString() ?? null,
      linkedBy: c.linkedById ? "team" : "agent",
      chatwootUrl: contactUrl(chat, c.chatwootId),
      conversations: (conversations[index] ?? []).map((conv) => conversationSummary(chat, conv)),
    })),
  };
}
