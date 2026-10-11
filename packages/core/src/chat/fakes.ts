import { createHmac } from "node:crypto";
import type { Context } from "../context.js";
import { hasLevel, type Level, type Permissions, type Resource } from "../permissions.js";
import * as cases from "../services/cases.js";
import * as clients from "../services/clients.js";
import * as templates from "../services/templates.js";
import * as uploadLinks from "../services/upload-links.js";
import type {
  ChatConnection,
  ChatwootAgentBot,
  ChatwootApi,
  ChatwootConversation,
  ChatwootInbox,
  ChatwootMessage,
} from "./chatwoot.js";
import type { ChatBlock, ChatModel, ChatRequest, ChatResponse } from "./model.js";
import type { AgentToolbox, AgentToolOutcome, AgentToolSpec } from "./toolbox.js";

type Status = ChatwootConversation["status"];
const ADMIN_TOKEN = "admin-token";

/** Chatwoot in memory, with what EzVisa calls. Messages record which token posted them. */
export class FakeChatwoot implements ChatwootApi {
  inboxList: ChatwootInbox[] = [{ id: 1, name: "LINE OA", channel_type: "Channel::Line" }];
  bots: Array<ChatwootAgentBot & { access_token: string; secret: string }> = [];
  inboxBots = new Map<number, number>();
  conversationList: ChatwootConversation[] = [];
  messageLog = new Map<number, ChatwootMessage[]>();
  contactAttributes = new Map<number, Record<string, string | null>>();
  attributeKeys: string[] = [];
  readUpTo = new Map<number, number>();
  private nextId = 100;
  now: () => Date = () => new Date();

  /** Adds a conversation with one incoming message from the contact. */
  addConversation(input: {
    id: number;
    contact: { id: number; name?: string; phone_number?: string };
    channel?: string;
    status?: Status;
    text?: string;
  }): ChatwootConversation {
    const conversation: ChatwootConversation = {
      id: input.id,
      status: input.status ?? "pending",
      inbox_id: 1,
      last_activity_at: Math.floor(this.now().getTime() / 1000),
      meta: { sender: input.contact, channel: input.channel ?? "Channel::Line" },
    };
    this.conversationList.push(conversation);
    this.messageLog.set(input.id, []);
    if (input.text) this.clientWrites(input.id, input.text);
    return conversation;
  }

  clientWrites(conversationId: number, text: string) {
    this.push(conversationId, {
      content: text,
      message_type: 0,
      private: false,
      sender: { type: "contact" },
    });
  }

  teamWrites(conversationId: number, text: string) {
    this.push(conversationId, {
      content: text,
      message_type: 1,
      private: false,
      sender: { type: "user" },
    });
  }

  private push(conversationId: number, m: Omit<ChatwootMessage, "id" | "created_at">) {
    const message: ChatwootMessage = {
      ...m,
      id: this.nextId++,
      created_at: Math.floor(this.now().getTime() / 1000),
    };
    this.messageLog.get(conversationId)?.push(message);
    return message;
  }

  /** Messages the bot posted, public ones by default. */
  botMessages(conversationId: number, options: { private?: boolean } = {}) {
    return (this.messageLog.get(conversationId) ?? []).filter(
      (m) => m.sender?.type === "agent_bot" && m.private === (options.private ?? false),
    );
  }

  status(conversationId: number) {
    return this.conversationList.find((c) => c.id === conversationId)?.status;
  }

  private senderType(token: string | undefined) {
    if (!token || token === ADMIN_TOKEN) return "user";
    if (this.bots.some((b) => b.access_token === token)) return "agent_bot";
    throw new Error("unknown token");
  }

  async profile() {
    return { id: 1, name: "Namtarn", accounts: [{ id: 1, role: "administrator" }] };
  }
  async inboxes() {
    return this.inboxList;
  }
  async inboxAgentBot(inboxId: number) {
    const id = this.inboxBots.get(inboxId);
    return this.bots.find((b) => b.id === id) ?? null;
  }
  async setInboxAgentBot(inboxId: number, botId: number | null) {
    if (botId === null) this.inboxBots.delete(inboxId);
    else this.inboxBots.set(inboxId, botId);
  }
  async agentBot(id: number) {
    return this.bots.find((b) => b.id === id) ?? null;
  }
  async createAgentBot(bot: { name: string; description: string; outgoing_url: string }) {
    const id = this.bots.length + 1;
    const created = { id, ...bot, access_token: `bot-token-${id}`, secret: `bot-secret-${id}` };
    this.bots.push(created);
    return created;
  }
  async updateAgentBot(id: number, update: { name?: string; outgoing_url?: string }) {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot) throw new Error("no bot");
    Object.assign(bot, update);
    return bot;
  }
  async conversations(query: { status: string; inboxId?: number }) {
    const items = this.conversationList
      .filter((c) => query.status === "all" || c.status === query.status)
      .filter((c) => !query.inboxId || c.inbox_id === query.inboxId)
      .map((c) => ({
        ...c,
        messages: this.messageLog.get(c.id)?.slice(-1),
        unread_count: (this.messageLog.get(c.id) ?? []).filter(
          (m) => m.message_type === 0 && m.id > (this.readUpTo.get(c.id) ?? 0),
        ).length,
      }));
    return { items, total: items.length };
  }
  async markRead(conversationId: number) {
    const last = this.messageLog.get(conversationId)?.at(-1);
    if (last) this.readUpTo.set(conversationId, last.id);
  }
  async updateContactAttributes(contactId: number, attributes: Record<string, string | null>) {
    this.contactAttributes.set(contactId, {
      ...this.contactAttributes.get(contactId),
      ...attributes,
    });
  }
  async contactAttributeKeys() {
    return this.attributeKeys;
  }
  async createContactAttribute(attribute: { key: string }) {
    this.attributeKeys.push(attribute.key);
  }
  async conversation(id: number) {
    return this.conversationList.find((c) => c.id === id) ?? null;
  }
  async contactConversations(contactId: number) {
    return this.conversationList.filter((c) => c.meta.sender.id === contactId);
  }
  async messages(conversationId: number) {
    return (this.messageLog.get(conversationId) ?? []).slice(-20);
  }
  async sendMessage(
    conversationId: number,
    message: { content: string; private?: boolean },
    asToken?: string,
  ) {
    return this.push(conversationId, {
      content: message.content,
      message_type: 1,
      private: message.private ?? false,
      sender: { type: this.senderType(asToken) },
    });
  }
  async setStatus(
    conversationId: number,
    status: "open" | "pending" | "resolved",
    asToken?: string,
  ) {
    this.senderType(asToken);
    const conversation = this.conversationList.find((c) => c.id === conversationId);
    if (conversation) conversation.status = status;
  }
}

export function fakeChatConnection(api: FakeChatwoot): ChatConnection {
  return { api, publicUrl: "https://chat.example.test", accountId: 1 };
}

/** Signs a webhook body the way Chatwoot does. */
export function signWebhook(secret: string, body: string, at: Date) {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { signature: `sha256=${digest}`, timestamp };
}

/** The webhook Chatwoot sends a bot when a client writes. */
export function incomingWebhook(conversation: ChatwootConversation, text: string): string {
  return JSON.stringify({
    event: "message_created",
    message_type: "incoming",
    private: false,
    content: text,
    conversation: { id: conversation.id, status: conversation.status },
  });
}

type ScriptStep =
  | { text: string }
  | { tool: string; input: Record<string, unknown>; text?: string };

/**
 * A model that answers from a script, one step per call: a tool call or a final text.
 * Records every request so tests can check what the model was shown.
 */
export class ScriptedModel implements ChatModel {
  readonly name = "scripted";
  requests: ChatRequest[] = [];
  private calls = 0;

  constructor(private readonly script: ScriptStep[]) {}

  async respond(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(request));
    const step = this.script[this.calls++];
    if (!step) throw new Error("The script ran out.");
    const usage = { input: 1000, output: 50, cacheRead: 800, cacheWrite: 0 };
    if ("tool" in step) {
      const content = [
        ...(step.text ? [{ type: "text", text: step.text, citations: null }] : []),
        { type: "tool_use", id: `call-${this.calls}`, name: step.tool, input: step.input },
      ] as ChatBlock[];
      return { content, stopReason: "tool_use", usage };
    }
    return {
      content: [{ type: "text", text: step.text, citations: null }] as ChatBlock[],
      stopReason: "end_turn",
      usage,
    };
  }

  /** The tool results the model received in its last request. */
  lastToolResults(): unknown[] {
    return this.toolResultsOf(this.requests.length - 1);
  }

  /** The tool results the model received in request `index`: JSON parsed, or the plain text. */
  toolResultsOf(index: number): unknown[] {
    const last = this.requests.at(index)?.messages.at(-1);
    if (!last || typeof last.content === "string") return [];
    return last.content
      .filter((b) => b.type === "tool_result")
      .map((b) => {
        const content = (b as { content?: unknown }).content;
        const first = Array.isArray(content) ? (content[0] as { text?: string }) : undefined;
        const raw = typeof content === "string" ? content : (first?.text ?? "");
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      });
  }
}

type FakeTool = {
  name: string;
  resource: Resource;
  level: Level;
  run: (ctx: Context, input: Record<string, unknown>) => Promise<unknown>;
};

/** A few of EzVisa's MCP tools, straight on the services, filtered by role like MCP does. */
const FAKE_TOOLS: FakeTool[] = [
  {
    name: "whoami",
    resource: "clients",
    level: "none",
    run: async (ctx) => ({ name: ctx.actor.name }),
  },
  {
    name: "list_clients",
    resource: "clients",
    level: "view",
    run: (ctx, i) => clients.listClients(ctx, i),
  },
  {
    name: "get_client",
    resource: "clients",
    level: "view",
    run: (ctx, i) => clients.getClient(ctx, i as never),
  },
  {
    name: "list_cases",
    resource: "cases",
    level: "view",
    run: (ctx, i) => cases.listCases(ctx, i),
  },
  {
    name: "get_case",
    resource: "cases",
    level: "view",
    run: (ctx, i) => cases.getCase(ctx, i as never),
  },
  {
    name: "update_case_item",
    resource: "cases",
    level: "edit",
    run: (ctx, i) => cases.updateCaseItem(ctx, i as never),
  },
  {
    name: "create_client_upload_link",
    resource: "cases",
    level: "edit",
    run: (ctx, i) => uploadLinks.createUploadLink(ctx, i as never),
  },
  {
    name: "list_templates",
    resource: "templates",
    level: "view",
    run: (ctx, i) => templates.listTemplates(ctx, i),
  },
];

export class FakeToolbox implements AgentToolbox {
  readonly instructions = "Dates are YYYY-MM-DD in Bangkok.";
  calls: Array<{ name: string; input: Record<string, unknown>; as: string }> = [];

  list(permissions: Permissions): AgentToolSpec[] {
    return FAKE_TOOLS.filter((t) => hasLevel(permissions, t.resource, t.level)).map((t) => ({
      name: t.name,
      description: t.name,
      input_schema: { type: "object" },
    }));
  }

  async run(ctx: Context, name: string, input: Record<string, unknown>): Promise<AgentToolOutcome> {
    this.calls.push({ name, input, as: ctx.actor.name });
    const tool = FAKE_TOOLS.find((t) => t.name === name);
    if (!tool || !hasLevel(ctx.actor.permissions, tool.resource, tool.level)) {
      return { content: [{ type: "text", text: `${name} is not allowed` }], isError: true };
    }
    try {
      return {
        content: [{ type: "text", text: JSON.stringify(await tool.run(ctx, input)) }],
        isError: false,
      };
    } catch (error) {
      return { content: [{ type: "text", text: String((error as Error).message) }], isError: true };
    }
  }
}

export { ADMIN_TOKEN };
