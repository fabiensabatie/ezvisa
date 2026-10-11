import { createHmac, timingSafeEqual } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@ezvisa/db";
import { audit } from "../audit.js";
import type { Actor, Context, FormJobs } from "../context.js";
import { bangkokToday, formatShortDate } from "../dates.js";
import { isDomainError } from "../errors.js";
import type { FormAi } from "../forms/ai.js";
import { hasLevel, intersectPermissions, parsePermissions } from "../permissions.js";
import type { PushSender } from "../services/notifications.js";
import { readPublicSettings } from "../services/settings.js";
import type { Storage } from "../storage.js";
import {
  type ChatConnection,
  type ChatwootConversation,
  type ChatwootMessage,
  channelName,
  MESSAGE_TYPE,
  senderKind,
} from "./chatwoot.js";
import type { ChatModel, ChatTool, ChatTurn } from "./model.js";
import { nameKey } from "./names.js";
import {
  BotCredentialsCache,
  clientPageUrl,
  readChatSettings,
  showClientInChatwoot,
} from "./setup.js";
import {
  type AgentToolbox,
  type AgentToolOutcome,
  clientScopedTools,
  scopeToClient,
} from "./toolbox.js";

const SIGNATURE_MAX_AGE_S = 5 * 60;
/** A person on the team wrote in the last 12 hours: the agent leaves the conversation to them. */
const HUMAN_QUIET_MS = 12 * 3_600_000;
/** More replies than this in a day means something is going round in circles. */
const MAX_REPLIES_PER_DAY = 30;
const MAX_TOOL_ROUNDS = 8;
const MAX_FAILED_CHECKS = 3;
const DAY_MS = 86_400_000;

export type ChatAgentsDeps = {
  db: Db;
  chat: ChatConnection;
  /** The model an agent asks for, or null when no API key is set: conversations then go to the team. */
  model: (name: string) => ChatModel | null;
  /** EzVisa's MCP tools. */
  toolbox: AgentToolbox;
  storage: Storage | null;
  push?: PushSender | null;
  appUrl: string | null;
  /** Claude for forms and the background runner, for agents that prepare forms. */
  forms?: FormAi | null;
  formJobs?: FormJobs | null;
  now?: () => Date;
  /** How long to wait for a client's follow-up messages before answering them together. */
  debounceMs?: number;
  log?: (entry: Record<string, unknown>) => void;
};

export type WebhookHeaders = {
  signature?: string | null;
  timestamp?: string | null;
  delivery?: string | null;
};

export type ProcessResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "replied"; handedOff: boolean; tools: string[] }
  | { outcome: "handed_off"; reason: string };

type Handoff = { reason: string; summary: string };

/**
 * Message events carry the conversation under `conversation` and name the message type;
 * conversation events are the conversation itself, at the top level.
 */
type WebhookPayload = {
  event?: string;
  id?: number;
  status?: string;
  message_type?: string;
  private?: boolean;
  conversation?: { id?: number; status?: string };
};

/**
 * Posted (privately) when a conversation goes back to "pending", for example after a person
 * hands it back. Replies from the team before this note no longer keep the agent quiet.
 */
export const RESUMED_NOTE = "The agent is answering this conversation again.";

const CHECK_IDENTITY: ChatTool = {
  name: "check_identity",
  description:
    "Confirms who the client is from their full name as in their passport and their date of birth, and links this conversation to their file. Required before any tool that touches a client's records.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string", description: "Full name as in the passport" },
      date_of_birth: { type: "string", description: "Date of birth as YYYY-MM-DD" },
    },
    required: ["full_name", "date_of_birth"],
  },
};

const HAND_TO_TEAM: ChatTool = {
  name: "hand_to_team",
  description:
    "Passes the conversation to a person on the team, who is notified. You stop answering in this conversation. Still reply to say someone will follow up.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why, in a few words, e.g. 'asks for a price'" },
      summary: {
        type: "string",
        description: "What the person wants and what you already did or said, for the team",
      },
    },
    required: ["reason", "summary"],
  },
};

const CHAT_STYLE = `How to write
- Reply in the language the person writes in.
- This is a chat app: short messages in plain text. No markdown, no headings, no bullet symbols other than simple dashes. A few short lines at most.
- Never invent facts, names, case numbers, documents, prices or timelines: look them up with the tools.`;

function clientRules(agency: string): string {
  return `You answer the clients and prospective clients of ${agency}, a visa agency in Chiang Mai, Thailand (Thai visas, extensions of stay, 90-day reports, re-entry permits and related paperwork at Chiang Mai Immigration), in their chat app, on the agency's behalf. You work in EzVisa, the agency's case system, through its tools.

${CHAT_STYLE}

Identity
- Before using any tool on a client's records, the client must be identified. If the conversation is not linked to a client yet, ask for their full name as in their passport and their date of birth, then call check_identity.
- Never say whether a name or date exists in the agency's records. If the check fails, ask them to check the spelling and the date. After three failures, hand the conversation to the team.
- The tools only work on the identified client's own records. Never discuss another person, even a family member.

Useful tools
- list_templates and get_template: the services and the documents each needs.
- list_cases and get_case: where the client's cases stand and what is still missing.
- create_client_upload_link: the client's private upload page for a case's checklist. Paste the url exactly as returned. It replaces any earlier link for that case.

Getting the client their checklist
- First find out what they need and match it to one template (list_templates, get_template). If you are not sure which service fits, ask; if it is still unclear or needs judgement, hand over.
- If the client already has an open case for that service (list_cases), share that case's checklist with create_client_upload_link. Never open a second case for the same service.
- Otherwise, say which service you will open and wait for their yes, then open it with create_case (clientId and the template's slug) and share its checklist with create_client_upload_link.
- Someone who is not a client yet: after check_identity fails or they say they are new, ask for their full name as in the passport, nationality and date of birth, confirm the service, then create_client. That links this conversation to them; open their case and share the checklist the same way.
- Never ask for a passport number in the chat. Never say the client accepted the privacy notice: they do that on the upload page.

Hand the conversation to the team (hand_to_team) when
- the client asks for a person, a price that is not in the agency notes, a refund or a discount, or complains;
- the question needs judgement: eligibility you are not sure of, an overstay, a refused application, a criminal record, a lost passport, a change of visa type;
- something is urgent: a deadline within 3 days, an appointment today;
- you are unsure, or the client is unhappy with your answers.
Then tell the client that someone from ${agency} will reply soon.

Never
- promise that immigration will approve anything, or give processing times other than those in the agency notes;
- ask for passport scans, bank documents or photos in the chat: send the upload link instead. If the client already sent a document here, thank them and send the link so it is filed securely;
- give legal advice beyond the agency notes and the templates.
If asked whether you are a person, say you are ${agency}'s automated assistant and that a person checks every application.`;
}

function teamRules(agency: string): string {
  return `You help the team of ${agency}, a visa agency in Chiang Mai, Thailand, in their team chat. You work in EzVisa, the agency's case system, through its tools, with at most the permissions of the person writing to you.

${CHAT_STYLE}

How to work
- Do what the person asks with the tools. Look things up before answering.
- Before anything hard to undo or that reaches a client (closing or cancelling a case, deleting, writing to a client, revoking access), say exactly what you will do and wait for their yes.
- Only a person can mark a checklist item VERIFIED or approve a pack: say so, and point them to the dashboard.
- To get a client their checklist: open a case from the right template with create_case if they have none open for that service, otherwise use the open one; then create_client_upload_link, and send_chat_message with the clientId to post the link in the client's own conversation once the person agrees.
- If a tool refuses for lack of permission, say so plainly. Hand the conversation to the team (hand_to_team) only when asked to.`;
}

/** The last nine digits, for comparing Thai and foreign ways of writing one number. */
function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-9);
}

function verifySignature(secret: string, raw: string, headers: WebhookHeaders, now: Date): boolean {
  const ts = headers.timestamp ?? "";
  const given = headers.signature ?? "";
  if (!/^\d+$/.test(ts) || !given.startsWith("sha256=")) return false;
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > SIGNATURE_MAX_AGE_S) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const a = Buffer.from(given.slice("sha256=".length), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chat history in the model's terms: the person writing is the user, the agency the assistant. */
function toTurns(messages: ChatwootMessage[]): ChatTurn[] {
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const m of messages) {
    if (m.private || m.message_type === MESSAGE_TYPE.activity) continue;
    const role = m.message_type === MESSAGE_TYPE.incoming ? "user" : "assistant";
    let text = (m.content ?? "").trim();
    const files = m.attachments?.length ?? 0;
    if (files > 0 && role === "user") {
      const kinds = [...new Set(m.attachments?.map((a) => a.file_type ?? "file"))].join(", ");
      text =
        `${text}\n[Sent ${files} attachment${files > 1 ? "s" : ""} in the chat: ${kinds}]`.trim();
    }
    if (!text) continue;
    const last = turns.at(-1);
    if (last && last.role === role) last.text = `${last.text}\n${text}`;
    else turns.push({ role, text });
  }
  if (turns[0]?.role === "assistant") {
    turns.unshift({ role: "user", text: "[The agency wrote first.]" });
  }
  return turns.map((t) => ({ role: t.role, content: t.text }));
}

/** A tool's outcome as tool_result content the model can read, images and PDFs included. */
function toResultContent(outcome: AgentToolOutcome): Anthropic.ToolResultBlockParam["content"] {
  return outcome.content.map((c) => {
    if (c.type === "image") {
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: c.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: c.data,
        },
      };
    }
    if (c.type === "document") {
      return {
        type: "document" as const,
        source: { type: "base64" as const, media_type: c.mediaType, data: c.data },
      };
    }
    return { type: "text" as const, text: c.text };
  });
}

const text = (value: unknown): AgentToolOutcome => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError: false,
});
const refusal = (message: string): AgentToolOutcome => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** A tool's JSON result, when it has one. */
function parsed(outcome: AgentToolOutcome): Record<string, unknown> | null {
  const first = outcome.content[0];
  if (first?.type !== "text") return null;
  try {
    const value = JSON.parse(first.text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Chatwoot's channel as a client's preferred channel in EzVisa. */
function clientChannel(channel: string | null | undefined) {
  if (!channel) return null;
  if (/Line/i.test(channel)) return "LINE" as const;
  if (/Whatsapp|Twilio/i.test(channel)) return "WHATSAPP" as const;
  if (/FacebookPage|Instagram/i.test(channel)) return "MESSENGER" as const;
  if (/Email/i.test(channel)) return "EMAIL" as const;
  if (/Sms/i.test(channel)) return "PHONE" as const;
  return null;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Private notes telling the team what an agent set up in the conversation. */
const TEAM_NOTES: Record<
  string,
  (
    agent: string,
    input: Record<string, unknown>,
    result: Record<string, unknown> | null,
  ) => string | null
> = {
  create_client: (agent, _input, result) =>
    result ? `${agent} created the client ${str(result.fullName)} from this conversation.` : null,
  create_case: (agent, _input, result) => {
    if (!result) return null;
    const template = (result.template ?? {}) as { name?: unknown };
    const client = (result.client ?? {}) as { fullName?: unknown };
    return `${agent} opened ${str(result.number)} (${str(template.name)}) for ${str(client.fullName)}.`;
  },
  create_client_upload_link: (agent, input, result) =>
    `${agent} shared the checklist for ${str(input.case)}${result?.expiresAt ? `; the link works until ${str(result.expiresAt).slice(0, 10)}` : ""}.`,
};

type LoadedAgent = NonNullable<Awaited<ReturnType<typeof loadAgent>>>;

function loadAgent(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return db.agent.findUnique({ where: { id }, include: { employee: { include: { role: true } } } });
}

/**
 * Runs the agents configured in EzVisa. Chatwoot sends each agent's bot the messages of the
 * inboxes it is assigned to; an agent answers conversations waiting for it ("pending") and
 * hands them to the team ("open") when it cannot help or a person has stepped in.
 */
export class ChatAgents {
  private readonly now: () => Date;
  private readonly creds: BotCredentialsCache;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly seen: string[] = [];

  constructor(private readonly deps: ChatAgentsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.creds = new BotCredentialsCache(deps.chat, this.now);
  }

  private log(entry: Record<string, unknown>) {
    (this.deps.log ?? ((e) => console.log(JSON.stringify(e))))(entry);
  }

  /**
   * Checks a webhook's signature with the agent's bot secret and queues the conversation.
   * Returns quickly: Chatwoot retries on errors, so the reply is written in the background.
   */
  async receive(
    agentId: string,
    raw: string,
    headers: WebhookHeaders,
  ): Promise<{ status: number; queued: boolean }> {
    const agent = await loadAgent(this.deps.db, agentId);
    if (!agent) return { status: 404, queued: false };
    let creds = await this.creds.get(agent.chatwootBotId);
    if (!creds) return { status: 503, queued: false };
    const now = this.now();
    if (!verifySignature(creds.secret, raw, headers, now)) {
      // The secret may have been reset in Chatwoot: read it again once.
      creds = await this.creds.get(agent.chatwootBotId, true);
      if (!creds || !verifySignature(creds.secret, raw, headers, now)) {
        return { status: 401, queued: false };
      }
    }
    if (headers.delivery) {
      if (this.seen.includes(headers.delivery)) return { status: 200, queued: false };
      this.seen.push(headers.delivery);
      if (this.seen.length > 500) this.seen.shift();
    }
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(raw) as WebhookPayload;
    } catch {
      return { status: 400, queued: false };
    }
    if (
      payload.event === "conversation_status_changed" &&
      payload.status === "pending" &&
      typeof payload.id === "number"
    ) {
      await this.deps.chat.api.sendMessage(
        payload.id,
        { content: RESUMED_NOTE, private: true },
        creds.token,
      );
      return { status: 200, queued: false };
    }
    const conversationId = payload.conversation?.id;
    const answerable =
      payload.event === "message_created" &&
      payload.message_type === "incoming" &&
      !payload.private &&
      payload.conversation?.status === "pending" &&
      typeof conversationId === "number";
    if (!answerable) return { status: 200, queued: false };
    this.schedule(agent.id, conversationId);
    return { status: 200, queued: true };
  }

  /** Answers once the person pauses, so three quick messages get one reply. */
  private schedule(agentId: string, conversationId: number) {
    const key = String(conversationId);
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      const previous = this.running.get(key) ?? Promise.resolve();
      const next = previous
        .then(() => this.process(agentId, conversationId))
        .catch((error: unknown) =>
          this.log({
            level: "error",
            msg: "chat agent failed",
            agentId,
            conversationId,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          }),
        )
        .finally(() => {
          if (this.running.get(key) === next) this.running.delete(key);
        });
      this.running.set(key, next);
    }, this.deps.debounceMs ?? 4_000);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** Resolves when nothing is queued or running. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.timers.size > 0 || this.running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.all(this.running.values());
    }
  }

  /** Reads the conversation and answers its latest messages, or hands it to the team. */
  async process(agentId: string, conversationId: number): Promise<ProcessResult> {
    const { db, chat } = this.deps;
    const agent = await loadAgent(db, agentId);
    if (!agent?.enabled || !agent.employee.active)
      return { outcome: "skipped", reason: "agent off" };
    const settings = await readChatSettings(db);
    if (!settings.enabled) return { outcome: "skipped", reason: "paused" };
    const creds = await this.creds.get(agent.chatwootBotId);
    if (!creds) return { outcome: "skipped", reason: "no bot" };

    const conversation = await chat.api.conversation(conversationId);
    if (conversation?.status !== "pending") {
      return { outcome: "skipped", reason: "not waiting for the agent" };
    }
    const messages = await chat.api.messages(conversationId);
    const now = this.now();
    // In Chatwoot's community edition a person replying leaves the conversation "pending":
    // the agent steps back itself, and opens it so it shows in the team's list.
    const latest = (match: (m: ChatwootMessage) => boolean) =>
      Math.max(0, ...messages.filter(match).map((m) => m.created_at));
    const humanAt = latest(
      (m) => senderKind(m) === "user" && m.message_type !== MESSAGE_TYPE.incoming,
    );
    const resumedAt = latest((m) => senderKind(m) === "bot" && m.content === RESUMED_NOTE);
    if (humanAt > resumedAt && now.getTime() - humanAt * 1000 < HUMAN_QUIET_MS) {
      await chat.api.setStatus(conversationId, "open", creds.token);
      return { outcome: "skipped", reason: "a person is answering" };
    }
    const turns = toTurns(messages);
    if (turns.at(-1)?.role !== "user") return { outcome: "skipped", reason: "already answered" };

    const { agentName: agency } = await readPublicSettings(db);
    const contact = await this.contactFor(agent, conversation);
    const base: Actor = {
      employeeId: agent.employeeId,
      name: agent.name,
      roleName: agent.employee.role.name,
      kind: "ASSISTANT",
      permissions: parsePermissions(agent.employee.role.permissions),
      tokenId: `agent:${agent.id}`,
    };
    const ctx = (actor: Actor): Context => ({
      actor,
      via: "CHAT",
      db,
      storage: this.deps.storage,
      now: this.now,
      push: this.deps.push ?? null,
      appUrl: this.deps.appUrl,
      chat,
      forms: this.deps.forms ?? null,
      formJobs: this.deps.formJobs ?? null,
    });

    // A team agent works with at most the permissions of the employee writing to it.
    let actor = base;
    let colleague: { name: string; role: string } | null = null;
    if (agent.audience === "TEAM") {
      const employee = contact.employeeId
        ? await db.employee.findUnique({
            where: { id: contact.employeeId },
            include: { role: true },
          })
        : null;
      if (!employee?.active || employee.kind !== "HUMAN") {
        const notice = `This chat is for the ${agency} team, and this account is not linked to anyone on it. Ask an owner to link it in EzVisa (Inbox, the conversation, Team member).`;
        const said = messages.some((m) => senderKind(m) === "bot" && m.content === notice);
        if (!said) await chat.api.sendMessage(conversationId, { content: notice }, creds.token);
        return { outcome: "skipped", reason: "unknown team member" };
      }
      actor = {
        ...base,
        permissions: intersectPermissions(
          base.permissions,
          parsePermissions(employee.role.permissions),
        ),
      };
      colleague = { name: employee.name, role: employee.role.name };
    }

    const repliesToday = messages.filter(
      (m) => senderKind(m) === "bot" && !m.private && now.getTime() - m.created_at * 1000 < DAY_MS,
    ).length;
    const model = this.deps.model(agent.model);
    if (!model || repliesToday >= MAX_REPLIES_PER_DAY) {
      const reason = model
        ? "The conversation went on too long for the agent."
        : "The agent is not set up (no ANTHROPIC_API_KEY), so it cannot answer.";
      await this.handOff(
        ctx(actor),
        agent,
        conversation,
        creds.token,
        { reason, summary: "" },
        null,
      );
      return { outcome: "handed_off", reason };
    }

    const mcpTools = this.deps.toolbox.list(actor.permissions);
    const tools: ChatTool[] =
      agent.audience === "CLIENTS"
        ? [CHECK_IDENTITY, HAND_TO_TEAM, ...clientScopedTools(mcpTools)]
        : [HAND_TO_TEAM, ...mcpTools];
    const allowed = new Set(tools.map((t) => t.name));
    const system = [
      agent.audience === "CLIENTS" ? clientRules(agency) : teamRules(agency),
      `Rules of EzVisa's tools:\n${this.deps.toolbox.instructions}`,
      `Agency notes from ${agency} (hours, prices, address, policies):\n${settings.instructions.trim() || "(none yet: hand price and opening-hours questions to the team)"}`,
      agent.instructions.trim()
        ? `Your instructions as ${agent.name}:\n${agent.instructions.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let handoff: Handoff | null = null;
    const used: string[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const history: ChatTurn[] = [...turns];
    let reply = "";
    let finished = false;
    let clientId = contact.clientId;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const client = clientId ? await db.client.findUnique({ where: { id: clientId } }) : null;
      const context = [
        `You are ${agent.name}. Today is ${formatShortDate(bangkokToday(now))} ${bangkokToday(now).slice(0, 4)} in Bangkok. This conversation is on ${channelName(conversation.meta.channel)}.`,
        colleague
          ? `You are talking with ${colleague.name} (${colleague.role}).`
          : client
            ? `It is linked to the client ${client.fullName} (clientId ${client.id}): they are identified.`
            : `It is not linked to a client yet. The contact's display name is "${conversation.meta.sender.name ?? "unknown"}", which proves nothing.`,
      ].join(" ");
      const response = await model.respond({ system, context, tools, messages: history });
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) {
        usage[key] += response.usage[key];
      }
      history.push({ role: "assistant", content: response.content });
      const calls = response.content.filter((b) => b.type === "tool_use");
      reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (calls.length === 0 || response.stopReason !== "tool_use") {
        finished = true;
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        used.push(call.name);
        const input = (call.input ?? {}) as Record<string, unknown>;
        let outcome: AgentToolOutcome;
        try {
          if (!allowed.has(call.name)) {
            outcome = refusal(`${call.name} is not available to ${agent.name}.`);
          } else if (call.name === "hand_to_team") {
            handoff = {
              reason: String(input.reason ?? "").slice(0, 300),
              summary: String(input.summary ?? "").slice(0, 2000),
            };
            outcome = text({ handedOver: true, next: "Say a person will reply soon." });
          } else if (call.name === "check_identity") {
            const checked = await this.checkIdentity(ctx(actor), contact.id, input);
            if (checked.clientId) clientId = checked.clientId;
            outcome = text(checked.result);
          } else if (agent.audience === "CLIENTS") {
            const scoped = await scopeToClient(db, call.name, input, {
              clientId,
              channel: clientChannel(conversation.meta.channel),
              phone: conversation.meta.sender.phone_number || null,
            });
            outcome =
              "refused" in scoped
                ? refusal(scoped.refused)
                : await this.deps.toolbox.run(ctx(actor), call.name, scoped.input);
            // A client created here is the person writing: the conversation is now theirs.
            const created =
              call.name === "create_client" && !outcome.isError ? parsed(outcome) : null;
            if (typeof created?.id === "string") {
              clientId = created.id;
              await this.linkCreatedClient(ctx(actor), contact.id, created.id);
            }
          } else {
            outcome = await this.deps.toolbox.run(ctx(actor), call.name, input);
          }
          if (!outcome.isError && TEAM_NOTES[call.name]) {
            const note = TEAM_NOTES[call.name]?.(agent.name, input, parsed(outcome));
            if (note) {
              await chat.api.sendMessage(
                conversationId,
                { content: note, private: true },
                creds.token,
              );
            }
          }
        } catch (error) {
          outcome = refusal(
            isDomainError(error) ? error.message : "That did not work. Try something else.",
          );
          if (!isDomainError(error)) {
            this.log({
              level: "error",
              msg: "agent tool failed",
              tool: call.name,
              error: String(error),
            });
          }
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: toResultContent(outcome),
          is_error: outcome.isError,
        });
      }
      history.push({ role: "user", content: results });
    }

    if (!finished && !handoff) {
      handoff = { reason: "The agent could not finish its answer.", summary: "" };
    }
    if (reply) await chat.api.sendMessage(conversationId, { content: reply }, creds.token);
    else if (!handoff) handoff = { reason: "The agent had nothing to say.", summary: "" };
    const clientName = clientId
      ? ((await db.client.findUnique({ where: { id: clientId } }))?.fullName ?? null)
      : null;
    if (handoff) {
      await this.handOff(ctx(actor), agent, conversation, creds.token, handoff, clientName);
    }

    await audit(db, ctx(actor), {
      action: "chat.replied",
      entity: "Conversation",
      entityId: String(conversationId),
      after: {
        agentId: agent.id,
        replied: Boolean(reply),
        tools: used,
        handedOff: handoff?.reason ?? null,
        model: model.name,
        tokens: usage,
      },
    });
    return { outcome: "replied", handedOff: handoff !== null, tools: used };
  }

  /** The EzVisa record for the person writing, linked to a client when the number matches. */
  private async contactFor(agent: LoadedAgent, conversation: ChatwootConversation) {
    const { db } = this.deps;
    const sender = conversation.meta.sender;
    const contact = await db.chatContact.upsert({
      where: { chatwootId: sender.id },
      update: { name: sender.name ?? undefined },
      create: {
        chatwootId: sender.id,
        name: sender.name ?? null,
        channel: conversation.meta.channel ?? null,
      },
    });
    // WhatsApp numbers are verified by Meta: one matching client is a safe link.
    const whatsapp = /Whatsapp|Twilio/i.test(conversation.meta.channel ?? "");
    const key = phoneKey(sender.phone_number);
    if (agent.audience !== "CLIENTS" || contact.clientId || !whatsapp || !key) return contact;
    const candidates = await db.client.findMany({
      where: { deletedAt: null, phone: { not: null } },
      select: { id: true, phone: true },
    });
    const matches = candidates.filter((c) => phoneKey(c.phone) === key);
    if (matches.length !== 1 || !matches[0]) return contact;
    const linked = await db.chatContact.update({
      where: { id: contact.id },
      data: { clientId: matches[0].id, linkedAt: this.now(), linkedById: null },
    });
    await audit(
      db,
      {
        actor: {
          employeeId: agent.employeeId,
          name: agent.name,
          roleName: agent.employee.role.name,
          kind: "ASSISTANT",
          permissions: parsePermissions(agent.employee.role.permissions),
          tokenId: `agent:${agent.id}`,
        },
        via: "CHAT",
        db,
        storage: null,
        now: this.now,
      },
      {
        action: "chat.contact_linked",
        entity: "Client",
        entityId: matches[0].id,
        after: { chatwootContactId: sender.id, by: "WhatsApp number" },
      },
    );
    await showClientInChatwoot(
      this.deps.chat,
      sender.id,
      clientPageUrl(this.deps.appUrl, matches[0].id),
    );
    return linked;
  }

  /** Links the conversation to the client an agent just created for the person writing. */
  private async linkCreatedClient(ctx: Context, contactId: string, clientId: string) {
    const { db } = this.deps;
    const contact = await db.chatContact.update({
      where: { id: contactId },
      data: { clientId, linkedAt: this.now(), linkedById: null, failedChecks: 0 },
    });
    await audit(db, ctx, {
      action: "chat.contact_linked",
      entity: "Client",
      entityId: clientId,
      after: { chatwootContactId: contact.chatwootId, by: "created from the chat" },
    });
    await showClientInChatwoot(
      this.deps.chat,
      contact.chatwootId,
      clientPageUrl(this.deps.appUrl, clientId),
    );
  }

  /** Full name and date of birth against EzVisa's clients; three failures a day lock it. */
  private async checkIdentity(
    ctx: Context,
    contactId: string,
    input: Record<string, unknown>,
  ): Promise<{ result: unknown; clientId?: string }> {
    const { db } = this.deps;
    const contact = await db.chatContact.findUniqueOrThrow({ where: { id: contactId } });
    if (contact.clientId) {
      const client = await db.client.findUnique({ where: { id: contact.clientId } });
      return {
        result: {
          identified: true,
          clientId: contact.clientId,
          firstName: client?.fullName.split(/\s+/)[0] ?? null,
        },
        clientId: contact.clientId,
      };
    }
    const now = this.now();
    const recentFailures =
      contact.lastFailedAt && now.getTime() - contact.lastFailedAt.getTime() < DAY_MS
        ? contact.failedChecks
        : 0;
    if (recentFailures >= MAX_FAILED_CHECKS) {
      return {
        result: { identified: false, locked: true, next: "Hand the conversation to the team." },
      };
    }
    const dob = String(input.date_of_birth ?? "").trim();
    const fullName = String(input.full_name ?? "");
    const candidates = /^\d{4}-\d{2}-\d{2}$/.test(dob)
      ? await db.client.findMany({
          where: { deletedAt: null, dateOfBirth: new Date(`${dob}T00:00:00.000Z`) },
          select: { id: true, fullName: true },
        })
      : [];
    const matches = candidates.filter((c) => nameKey(c.fullName) === nameKey(fullName));
    if (matches.length === 1 && matches[0]) {
      const match = matches[0];
      await db.chatContact.update({
        where: { id: contact.id },
        data: { clientId: match.id, linkedAt: now, linkedById: null, failedChecks: 0 },
      });
      await audit(db, ctx, {
        action: "chat.contact_linked",
        entity: "Client",
        entityId: match.id,
        after: { chatwootContactId: contact.chatwootId, by: "name and date of birth" },
      });
      await showClientInChatwoot(
        this.deps.chat,
        contact.chatwootId,
        clientPageUrl(this.deps.appUrl, match.id),
      );
      return {
        result: { identified: true, clientId: match.id, firstName: match.fullName.split(/\s+/)[0] },
        clientId: match.id,
      };
    }
    const failures = recentFailures + 1;
    await db.chatContact.update({
      where: { id: contact.id },
      data: { failedChecks: failures, lastFailedAt: now },
    });
    return {
      result: {
        identified: false,
        attemptsLeft: Math.max(0, MAX_FAILED_CHECKS - failures),
        next:
          failures >= MAX_FAILED_CHECKS
            ? "Hand the conversation to the team."
            : "Ask the client to check the spelling as in the passport and the date of birth.",
      },
    };
  }

  /** Leaves a note for the team, opens the conversation for them and notifies them. */
  private async handOff(
    ctx: Context,
    agent: LoadedAgent,
    conversation: ChatwootConversation,
    botToken: string,
    handoff: Handoff,
    clientName: string | null,
  ) {
    const { chat, db } = this.deps;
    const note = [
      `${agent.name} handed this to the team: ${handoff.reason}`,
      handoff.summary,
      clientName ? `Identified client: ${clientName}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    await chat.api.sendMessage(conversation.id, { content: note, private: true }, botToken);
    await chat.api.setStatus(conversation.id, "open", botToken);
    await audit(db, ctx, {
      action: "chat.handed_off",
      entity: "Conversation",
      entityId: String(conversation.id),
      after: {
        reason: handoff.reason,
        channel: channelName(conversation.meta.channel),
        agentId: agent.id,
      },
    });
    if (this.deps.push) await this.notifyTeam(conversation, this.deps.push);
  }

  /** Client names stay out of the notification, which can show on a locked phone. */
  private async notifyTeam(conversation: ChatwootConversation, push: PushSender) {
    const { db } = this.deps;
    const subscriptions = await db.pushSubscription.findMany({
      where: { employee: { active: true, kind: "HUMAN" } },
      include: { employee: { include: { role: true } } },
    });
    const now = this.now();
    for (const sub of subscriptions) {
      if (!hasLevel(parsePermissions(sub.employee.role.permissions), "clients", "edit")) continue;
      const outcome = await push.send(sub, {
        title: "A conversation needs a person",
        body: `An agent passed a ${channelName(conversation.meta.channel)} conversation to the team.`,
        // Opens the conversation in EzVisa's inbox, next to the client's cases.
        url: `/inbox/${conversation.id}`,
        tag: `chat-${conversation.id}`,
      });
      if (outcome === "gone") await db.pushSubscription.deleteMany({ where: { id: sub.id } });
      else if (outcome === "sent") {
        await db.pushSubscription.update({ where: { id: sub.id }, data: { lastSentAt: now } });
      }
    }
  }
}
