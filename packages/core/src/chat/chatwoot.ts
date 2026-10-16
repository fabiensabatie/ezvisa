/**
 * The shared inbox: a self-hosted Chatwoot that receives LINE, Messenger, WhatsApp and other
 * channels. EzVisa talks to its REST API with an administrator's access token, and posts as
 * its own agent bot ("<agency> assistant") with the bot's token.
 */

/** Message types as the REST API returns them (webhooks use the names instead). */
export const MESSAGE_TYPE = { incoming: 0, outgoing: 1, activity: 2, template: 3 } as const;

export type ChatwootInbox = {
  id: number;
  name: string;
  channel_type: string;
  /** Twilio inboxes: "whatsapp" or "sms" */
  medium?: string | null;
};

export type ChatwootContact = {
  id: number;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  thumbnail?: string | null;
};

export type ChatwootAttachment = {
  id?: number;
  /** "image", "audio", "video", "file", "location"… */
  file_type?: string | null;
  /** A signed link to the file on Chatwoot */
  data_url?: string | null;
  thumb_url?: string | null;
  file_size?: number | null;
  extension?: string | null;
};

export type ChatwootMessage = {
  id: number;
  content: string | null;
  /** 0 incoming, 1 outgoing, 2 activity, 3 template */
  message_type: number;
  private: boolean;
  /** Unix seconds */
  created_at: number;
  /** "contact", "user" (a person on the team) or "agent_bot" */
  sender?: { id?: number; name?: string | null; type?: string | null } | null;
  /** Present on messages embedded in a conversation, absent from the messages list. */
  sender_type?: string | null;
  attachments?: ChatwootAttachment[] | null;
};

/** Who wrote a message, from either shape Chatwoot uses. */
export function senderKind(message: ChatwootMessage): "contact" | "user" | "bot" | null {
  const kind = message.sender?.type ?? message.sender_type ?? null;
  if (kind === "contact" || kind === "Contact") return "contact";
  if (kind === "user" || kind === "User") return "user";
  if (kind === "agent_bot" || kind === "AgentBot") return "bot";
  return null;
}

export type ChatwootConversation = {
  /** The number shown in Chatwoot's URLs (display id) */
  id: number;
  status: "open" | "resolved" | "pending" | "snoozed";
  inbox_id: number;
  /** Unix seconds */
  last_activity_at?: number | null;
  meta: { sender: ChatwootContact; channel?: string | null };
  messages?: ChatwootMessage[];
  unread_count?: number | null;
};

export type ChatwootAgentBot = {
  id: number;
  name: string;
  outgoing_url?: string | null;
  /** Shown to administrators only */
  access_token?: string | null;
  /** Signs the webhooks sent to the bot; shown to administrators only */
  secret?: string | null;
};

/** What EzVisa needs from Chatwoot. HttpChatwoot talks to the real one; tests use a fake. */
export interface ChatwootApi {
  profile(): Promise<{ id: number; name: string; accounts: Array<{ id: number; role: string }> }>;
  inboxes(): Promise<ChatwootInbox[]>;
  inboxAgentBot(inboxId: number): Promise<ChatwootAgentBot | null>;
  setInboxAgentBot(inboxId: number, botId: number | null): Promise<void>;
  agentBot(id: number): Promise<ChatwootAgentBot | null>;
  createAgentBot(bot: {
    name: string;
    description: string;
    outgoing_url: string;
  }): Promise<ChatwootAgentBot>;
  updateAgentBot(
    id: number,
    bot: { name?: string; outgoing_url?: string },
  ): Promise<ChatwootAgentBot>;
  /** One page (25) of conversations, newest activity first, and how many match in all. */
  conversations(query: {
    status: string;
    page: number;
    inboxId?: number;
  }): Promise<{ items: ChatwootConversation[]; total: number }>;
  conversation(id: number): Promise<ChatwootConversation | null>;
  contactConversations(contactId: number): Promise<ChatwootConversation[]>;
  /** The latest messages of a conversation, oldest first (Chatwoot returns about 20). */
  messages(conversationId: number): Promise<ChatwootMessage[]>;
  /** Posts as the token's owner: the bot when `asToken` is the bot's token. */
  sendMessage(
    conversationId: number,
    message: { content: string; private?: boolean },
    asToken?: string,
  ): Promise<ChatwootMessage>;
  setStatus(
    conversationId: number,
    status: "open" | "pending" | "resolved",
    asToken?: string,
  ): Promise<void>;
  /** Marks the conversation read, as when someone opens it in Chatwoot. */
  markRead(conversationId: number): Promise<void>;
  /** Merges custom attributes into the contact's. */
  updateContactAttributes(
    contactId: number,
    attributes: Record<string, string | null>,
  ): Promise<void>;
  contactAttributeKeys(): Promise<string[]>;
  createContactAttribute(attribute: {
    key: string;
    name: string;
    description: string;
    type: "link" | "text";
  }): Promise<void>;
}

/** The shared inbox as configured on the server. */
export type ChatConnection = {
  api: ChatwootApi;
  /** Where people open Chatwoot, e.g. https://chat.example.com */
  publicUrl: string;
  accountId: number;
};

export class ChatwootError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChatwootError";
  }
}

const TIMEOUT_MS = 15_000;

export class HttpChatwoot implements ChatwootApi {
  constructor(
    private readonly baseUrl: string,
    private readonly accountId: number,
    private readonly token: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    asToken?: string,
  ): Promise<T> {
    const url = path.startsWith("/api/v1/profile")
      ? `${this.baseUrl}${path}`
      : `${this.baseUrl}/api/v1/accounts/${this.accountId}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        api_access_token: asToken ?? this.token,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Chatwoot's error bodies can echo request data; keep only the status in the message.
      throw new ChatwootError(`Chatwoot answered ${res.status} to ${method} ${path}`, res.status);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async orNull<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ChatwootError && error.status === 404) return null;
      throw error;
    }
  }

  profile() {
    return this.request<{
      id: number;
      name: string;
      accounts: Array<{ id: number; role: string }>;
    }>("GET", "/api/v1/profile");
  }

  async inboxes() {
    const res = await this.request<{ payload: ChatwootInbox[] }>("GET", "/inboxes");
    return res.payload;
  }

  async inboxAgentBot(inboxId: number) {
    const res = await this.orNull(
      this.request<{ agent_bot?: ChatwootAgentBot | null }>("GET", `/inboxes/${inboxId}/agent_bot`),
    );
    // An inbox without a bot answers with an empty object.
    return res?.agent_bot?.id ? res.agent_bot : null;
  }

  async setInboxAgentBot(inboxId: number, botId: number | null) {
    await this.request("POST", `/inboxes/${inboxId}/set_agent_bot`, { agent_bot: botId });
  }

  agentBot(id: number) {
    return this.orNull(this.request<ChatwootAgentBot>("GET", `/agent_bots/${id}`));
  }

  createAgentBot(bot: { name: string; description: string; outgoing_url: string }) {
    return this.request<ChatwootAgentBot>("POST", "/agent_bots", { ...bot, bot_type: 0 });
  }

  updateAgentBot(id: number, bot: { name?: string; outgoing_url?: string }) {
    return this.request<ChatwootAgentBot>("PATCH", `/agent_bots/${id}`, bot);
  }

  async conversations(query: { status: string; page: number; inboxId?: number }) {
    const params = new URLSearchParams({
      status: query.status,
      page: String(query.page),
      assignee_type: "all",
      ...(query.inboxId ? { inbox_id: String(query.inboxId) } : {}),
    });
    const res = await this.request<{
      data: { meta?: { all_count?: number }; payload: ChatwootConversation[] };
    }>("GET", `/conversations?${params}`);
    return { items: res.data.payload, total: res.data.meta?.all_count ?? res.data.payload.length };
  }

  conversation(id: number) {
    return this.orNull(this.request<ChatwootConversation>("GET", `/conversations/${id}`));
  }

  async contactConversations(contactId: number) {
    const res = await this.orNull(
      this.request<{ payload: ChatwootConversation[] }>(
        "GET",
        `/contacts/${contactId}/conversations`,
      ),
    );
    return res?.payload ?? [];
  }

  async messages(conversationId: number) {
    const res = await this.request<{ payload: ChatwootMessage[] }>(
      "GET",
      `/conversations/${conversationId}/messages`,
    );
    return res.payload;
  }

  sendMessage(
    conversationId: number,
    message: { content: string; private?: boolean },
    asToken?: string,
  ) {
    return this.request<ChatwootMessage>(
      "POST",
      `/conversations/${conversationId}/messages`,
      { content: message.content, message_type: "outgoing", private: message.private ?? false },
      asToken,
    );
  }

  async markRead(conversationId: number) {
    await this.request("POST", `/conversations/${conversationId}/update_last_seen`);
  }

  async updateContactAttributes(contactId: number, attributes: Record<string, string | null>) {
    await this.request("PUT", `/contacts/${contactId}`, { custom_attributes: attributes });
  }

  async contactAttributeKeys() {
    const res = await this.request<Array<{ attribute_key: string }>>(
      "GET",
      "/custom_attribute_definitions?attribute_model=1",
    );
    return res.map((a) => a.attribute_key);
  }

  async createContactAttribute(attribute: {
    key: string;
    name: string;
    description: string;
    type: "link" | "text";
  }) {
    await this.request("POST", "/custom_attribute_definitions", {
      custom_attribute_definition: {
        attribute_display_name: attribute.name,
        attribute_description: attribute.description,
        attribute_key: attribute.key,
        attribute_model: "contact_attribute",
        attribute_display_type: attribute.type,
      },
    });
  }

  async setStatus(
    conversationId: number,
    status: "open" | "pending" | "resolved",
    asToken?: string,
  ) {
    await this.request(
      "POST",
      `/conversations/${conversationId}/toggle_status`,
      { status },
      asToken,
    );
  }
}

/**
 * The shared inbox from CHATWOOT_URL and CHATWOOT_API_TOKEN (an administrator's access
 * token, from their Chatwoot profile). Null when either is missing: chat features are off.
 */
export function chatFromEnv(env: NodeJS.ProcessEnv = process.env): ChatConnection | null {
  const url = env.CHATWOOT_URL?.trim().replace(/\/+$/, "");
  const token = env.CHATWOOT_API_TOKEN?.trim();
  if (!url || !token) return null;
  const accountId = Number(env.CHATWOOT_ACCOUNT_ID ?? 1) || 1;
  return { api: new HttpChatwoot(url, accountId, token), publicUrl: url, accountId };
}

/** Links people open in Chatwoot. */
export function conversationUrl(chat: Pick<ChatConnection, "publicUrl" | "accountId">, id: number) {
  return `${chat.publicUrl}/app/accounts/${chat.accountId}/conversations/${id}`;
}
export function contactUrl(chat: Pick<ChatConnection, "publicUrl" | "accountId">, id: number) {
  return `${chat.publicUrl}/app/accounts/${chat.accountId}/contacts/${id}`;
}

/**
 * "Channel::Line" → "LINE", for people and push messages. Twilio carries both WhatsApp and
 * SMS under one channel type; its inbox's medium says which.
 */
export function channelName(
  channel: string | null | undefined,
  medium?: string | null | undefined,
): string {
  if (channel === "Channel::TwilioSms" && medium) {
    return medium === "whatsapp" ? "WhatsApp" : "SMS";
  }
  const names: Record<string, string> = {
    "Channel::Line": "LINE",
    "Channel::FacebookPage": "Messenger",
    "Channel::Instagram": "Instagram",
    "Channel::Whatsapp": "WhatsApp",
    "Channel::TwilioSms": "WhatsApp or SMS",
    "Channel::Telegram": "Telegram",
    "Channel::Email": "email",
    "Channel::WebWidget": "website chat",
    "Channel::Sms": "SMS",
    "Channel::Api": "chat",
  };
  return (channel && names[channel]) ?? "chat";
}

/** An inbox's channel, as people call it. */
export function inboxChannel(inbox: Pick<ChatwootInbox, "channel_type" | "medium">): string {
  return channelName(inbox.channel_type, inbox.medium);
}
