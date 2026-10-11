import type { Db } from "@ezvisa/db";
import type { Tx } from "../context.js";
import { DomainError } from "../errors.js";
import type { ChatConnection, ChatwootAgentBot, ChatwootApi } from "./chatwoot.js";

// ---- settings shared by every agent ---------------------------------------------------------

const SETTINGS_KEY = "chat.assistant";

export type ChatSettings = {
  /** Off pauses every agent; conversations then wait for the team. */
  enabled: boolean;
  /** What every agent should know: hours, prices, address, policies. */
  instructions: string;
};

export async function readChatSettings(tx: Tx): Promise<ChatSettings> {
  const row = await tx.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const value = (row?.value ?? {}) as Partial<ChatSettings>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    instructions: typeof value.instructions === "string" ? value.instructions : "",
  };
}

export async function writeChatSettings(tx: Tx, settings: ChatSettings): Promise<void> {
  await tx.setting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: settings },
    create: { key: SETTINGS_KEY, value: settings },
  });
}

// ---- each agent's bot in Chatwoot -----------------------------------------------------------

export function webhookUrl(appUrl: string, agentId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/chat/webhook/${agentId}`;
}

type AgentForBot = { id: string; name: string; chatwootBotId: number | null };

/**
 * Finds or creates the agent's bot in Chatwoot and points its webhook at this server.
 * Returns the bot with its access token and webhook secret, which only administrators see.
 */
export async function ensureAgentBot(
  db: Db,
  chat: ChatConnection,
  appUrl: string | null | undefined,
  agent: AgentForBot,
): Promise<ChatwootAgentBot> {
  if (!appUrl) {
    throw new DomainError(
      "CONFLICT",
      "APP_URL is not set on the server, so Chatwoot would not know where to send messages.",
    );
  }
  const outgoing = webhookUrl(appUrl, agent.id);
  let bot = agent.chatwootBotId === null ? null : await chat.api.agentBot(agent.chatwootBotId);
  if (!bot) {
    bot = await chat.api.createAgentBot({
      name: agent.name,
      description: "An EzVisa agent. Hands conversations to the team when it cannot help.",
      outgoing_url: outgoing,
    });
    await db.agent.update({ where: { id: agent.id }, data: { chatwootBotId: bot.id } });
  } else if (bot.outgoing_url !== outgoing || bot.name !== agent.name) {
    bot = await chat.api.updateAgentBot(bot.id, { name: agent.name, outgoing_url: outgoing });
  }
  if (!bot.access_token || !bot.secret) {
    // Chatwoot shows both only to administrators of the account.
    bot = (await chat.api.agentBot(bot.id)) ?? bot;
  }
  if (!bot.access_token || !bot.secret) {
    throw new DomainError(
      "FORBIDDEN",
      "Chatwoot did not return the bot's token. CHATWOOT_API_TOKEN must belong to an administrator.",
    );
  }
  return bot;
}

export type BotCredentials = { id: number; token: string; secret: string };

/**
 * Each agent's bot token and webhook secret, read from Chatwoot and kept in memory for ten
 * minutes. Only found credentials are kept: a bot created later is picked up at once.
 */
export class BotCredentialsCache {
  private readonly values = new Map<number, { at: number; creds: BotCredentials }>();

  constructor(
    private readonly chat: ChatConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(botId: number | null, refresh = false): Promise<BotCredentials | null> {
    if (botId === null) return null;
    const at = this.now().getTime();
    const cached = this.values.get(botId);
    if (!refresh && cached && at - cached.at < 10 * 60_000) return cached.creds;
    const bot = await this.chat.api.agentBot(botId);
    const creds =
      bot?.access_token && bot.secret
        ? { id: bot.id, token: bot.access_token, secret: bot.secret }
        : null;
    if (creds) this.values.set(botId, { at, creds });
    else this.values.delete(botId);
    return creds;
  }
}

// ---- the way back from Chatwoot -------------------------------------------------------------

const CLIENT_ATTRIBUTE = "ezvisa_client";
const attributeReady = new WeakMap<ChatwootApi, Promise<void>>();

async function ensureClientAttribute(api: ChatwootApi): Promise<void> {
  const keys = await api.contactAttributeKeys();
  if (keys.includes(CLIENT_ATTRIBUTE)) return;
  await api.createContactAttribute({
    key: CLIENT_ATTRIBUTE,
    name: "EzVisa client",
    description: "The client's page in EzVisa: cases, documents and deadlines.",
    type: "link",
  });
}

export function clientPageUrl(appUrl: string | null | undefined, clientId: string): string | null {
  return appUrl ? `${appUrl.replace(/\/+$/, "")}/clients/${clientId}` : null;
}

/**
 * Shows a link to the client's EzVisa page on the contact in Chatwoot (or removes it), so
 * whoever answers there is one click from the case. Best effort: Chatwoot being down
 * never stops a link being made in EzVisa.
 */
export async function showClientInChatwoot(
  chat: ChatConnection,
  contactId: number,
  url: string | null,
): Promise<void> {
  try {
    if (url) {
      let ready = attributeReady.get(chat.api);
      if (!ready) {
        ready = ensureClientAttribute(chat.api);
        attributeReady.set(chat.api, ready);
        ready.catch(() => attributeReady.delete(chat.api));
      }
      await ready;
    }
    await chat.api.updateContactAttributes(contactId, { [CLIENT_ATTRIBUTE]: url });
  } catch {
    // The link in Chatwoot is a convenience; EzVisa's own record is what counts.
  }
}
