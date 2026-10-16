import { z } from "zod";
import { audit } from "../audit.js";
import { type ChatConnection, ChatwootError, inboxChannel } from "../chat/chatwoot.js";
import { ensureAgentBot } from "../chat/setup.js";
import { type Context, requireLevel } from "../context.js";
import { DomainError } from "../errors.js";
import { id, notFound } from "../refs.js";

/** The models an agent can use. Sonnet suits most conversations; Haiku costs less. */
export const AGENT_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, cheapest)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable, costliest)" },
] as const;
const MODEL_IDS = AGENT_MODELS.map((m) => m.id) as [string, ...string[]];

const fields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe("Shown to the team and as the bot's name in Chatwoot"),
  audience: z
    .enum(["CLIENTS", "TEAM"])
    .describe(
      "CLIENTS: answers clients, one identified client at a time; TEAM: answers linked employees",
    ),
  roleId: id("Role").describe("Decides which MCP tools the agent may use"),
  model: z.enum(MODEL_IDS),
  instructions: z
    .string()
    .max(8000)
    .describe("How this agent should work: its job, tone, what to ask, when to hand over"),
  enabled: z.boolean(),
};

export const createAgentInput = z.object({
  ...fields,
  model: fields.model.default("claude-sonnet-5-5"),
  instructions: fields.instructions.default(""),
  enabled: fields.enabled.default(true),
});
export const updateAgentInput = z.object({
  agentId: id("Agent"),
  name: fields.name.optional(),
  audience: fields.audience.optional(),
  roleId: fields.roleId.optional(),
  model: fields.model.optional(),
  instructions: fields.instructions.optional(),
  enabled: fields.enabled.optional(),
});
export const agentRefInput = z.object({ agentId: id("Agent") });
export const setAgentInboxesInput = z.object({
  agentId: id("Agent"),
  inboxIds: z
    .array(z.number().int().positive())
    .max(50)
    .describe("The inboxes this agent answers. An inbox has one agent; assigning moves it here."),
});

const include = { employee: { include: { role: true } } } as const;

async function findAgent(ctx: Context, agentId: string) {
  const agent = await ctx.db.agent.findUnique({ where: { id: agentId }, include });
  if (!agent) throw notFound("agent", agentId);
  return agent;
}

/** Chatwoot errors become messages the dashboard can show. */
async function inChatwoot<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ChatwootError) {
      throw new DomainError(
        "CONFLICT",
        error.status === 401
          ? "Chatwoot refused the access token. Check CHATWOOT_API_TOKEN on the server."
          : `Chatwoot could not do that (${error.status}).`,
      );
    }
    throw error;
  }
}

/** Which agent answers each inbox, from the bots Chatwoot has on them. */
async function inboxAssignments(chat: ChatConnection) {
  const inboxes = await chat.api.inboxes();
  const bots = await Promise.all(inboxes.map((i) => chat.api.inboxAgentBot(i.id)));
  return inboxes.map((inbox, index) => ({
    id: inbox.id,
    name: inbox.name,
    channel: inboxChannel(inbox),
    botId: bots[index]?.id ?? null,
    botName: bots[index]?.name ?? null,
  }));
}

/** The agents, the inboxes they answer and what the form needs to create one. */
export async function listAgents(ctx: Context) {
  requireLevel(ctx, "settings", "view");
  const [agents, roles] = await Promise.all([
    ctx.db.agent.findMany({ include, orderBy: { createdAt: "asc" } }),
    ctx.db.role.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true },
    }),
  ]);
  let inboxes: Awaited<ReturnType<typeof inboxAssignments>> = [];
  let chatError: string | null = ctx.chat ? null : "The shared inbox is not connected.";
  if (ctx.chat) {
    try {
      inboxes = await inboxAssignments(ctx.chat);
    } catch {
      chatError = "Chatwoot did not answer, so the inboxes cannot be shown.";
    }
  }
  return {
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      audience: a.audience,
      model: a.model,
      instructions: a.instructions,
      enabled: a.enabled,
      role: { id: a.employee.role.id, name: a.employee.role.name },
      employeeId: a.employeeId,
      botReady: a.chatwootBotId !== null,
      inboxIds: inboxes
        .filter((i) => i.botId !== null && i.botId === a.chatwootBotId)
        .map((i) => i.id),
    })),
    inboxes: inboxes.map((i) => ({
      id: i.id,
      name: i.name,
      channel: i.channel,
      agentId:
        agents.find((a) => a.chatwootBotId !== null && a.chatwootBotId === i.botId)?.id ?? null,
      otherBot:
        i.botId !== null && !agents.some((a) => a.chatwootBotId === i.botId) ? i.botName : null,
    })),
    roles,
    models: AGENT_MODELS,
    modelReady: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    chatError,
  };
}

/** Its bot in Chatwoot, made or renamed when the inbox is connected. Failures wait for later. */
async function syncBot(
  ctx: Context,
  agent: { id: string; name: string; chatwootBotId: number | null },
) {
  if (!ctx.chat || !ctx.appUrl) return;
  try {
    await ensureAgentBot(ctx.db, ctx.chat, ctx.appUrl, agent);
  } catch {
    // Assigning an inbox tries again and reports what is wrong.
  }
}

/**
 * Creates an agent. It acts as its own team member (kind ASSISTANT) with the chosen role,
 * like an MCP token, so the Team page and the activity feed show what it does.
 */
export async function createAgent(ctx: Context, raw: z.input<typeof createAgentInput>) {
  requireLevel(ctx, "team", "full");
  const input = createAgentInput.parse(raw);
  if (!(await ctx.db.role.findUnique({ where: { id: input.roleId } }))) {
    throw notFound("role", input.roleId);
  }
  if (await ctx.db.agent.findUnique({ where: { name: input.name } })) {
    throw new DomainError("CONFLICT", `An agent is already called ${input.name}.`);
  }
  const agent = await ctx.db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: { name: input.name, kind: "ASSISTANT", roleId: input.roleId },
    });
    const created = await tx.agent.create({
      data: {
        name: input.name,
        audience: input.audience,
        model: input.model,
        instructions: input.instructions.trim(),
        enabled: input.enabled,
        employeeId: employee.id,
      },
    });
    await audit(tx, ctx, {
      action: "agent.created",
      entity: "Agent",
      entityId: created.id,
      after: {
        name: created.name,
        audience: created.audience,
        roleId: input.roleId,
        model: created.model,
      },
    });
    return created;
  });
  await syncBot(ctx, agent);
  return { id: agent.id, name: agent.name };
}

export async function updateAgent(ctx: Context, raw: z.input<typeof updateAgentInput>) {
  requireLevel(ctx, "team", "full");
  const input = updateAgentInput.parse(raw);
  const before = await findAgent(ctx, input.agentId);
  if (input.roleId && !(await ctx.db.role.findUnique({ where: { id: input.roleId } }))) {
    throw notFound("role", input.roleId);
  }
  if (
    input.name &&
    input.name !== before.name &&
    (await ctx.db.agent.findUnique({ where: { name: input.name } }))
  ) {
    throw new DomainError("CONFLICT", `An agent is already called ${input.name}.`);
  }
  const agent = await ctx.db.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: before.employeeId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.enabled !== undefined ? { active: input.enabled } : {}),
      },
    });
    const updated = await tx.agent.update({
      where: { id: before.id },
      data: {
        name: input.name,
        audience: input.audience,
        model: input.model,
        instructions: input.instructions?.trim(),
        enabled: input.enabled,
      },
    });
    await audit(tx, ctx, {
      action: "agent.updated",
      entity: "Agent",
      entityId: updated.id,
      before: {
        name: before.name,
        audience: before.audience,
        roleId: before.employee.roleId,
        model: before.model,
        enabled: before.enabled,
      },
      after: {
        name: updated.name,
        audience: updated.audience,
        roleId: input.roleId ?? before.employee.roleId,
        model: updated.model,
        enabled: updated.enabled,
      },
    });
    return updated;
  });
  if (input.name && input.name !== before.name) await syncBot(ctx, agent);
  return { id: agent.id, name: agent.name };
}

/** The inboxes an agent answers. New conversations there go to it first. */
export async function setAgentInboxes(ctx: Context, raw: z.input<typeof setAgentInboxesInput>) {
  requireLevel(ctx, "team", "full");
  const input = setAgentInboxesInput.parse(raw);
  const agent = await findAgent(ctx, input.agentId);
  const chat = ctx.chat;
  if (!chat) {
    throw new DomainError(
      "CONFLICT",
      "The shared inbox is not connected. Set CHATWOOT_URL and CHATWOOT_API_TOKEN.",
    );
  }
  const wanted = new Set(input.inboxIds);
  await inChatwoot(async () => {
    const bot = await ensureAgentBot(ctx.db, chat, ctx.appUrl, agent);
    for (const inbox of await inboxAssignments(chat)) {
      if (wanted.has(inbox.id) && inbox.botId !== bot.id)
        await chat.api.setInboxAgentBot(inbox.id, bot.id);
      else if (!wanted.has(inbox.id) && inbox.botId === bot.id)
        await chat.api.setInboxAgentBot(inbox.id, null);
    }
  });
  await audit(ctx.db, ctx, {
    action: "agent.inboxes_set",
    entity: "Agent",
    entityId: agent.id,
    after: { inboxIds: input.inboxIds },
  });
  return { agentId: agent.id, inboxIds: input.inboxIds };
}

/** Removes an agent: its inboxes go back to the team; its team member stays, deactivated, for the record. */
export async function deleteAgent(ctx: Context, raw: z.input<typeof agentRefInput>) {
  requireLevel(ctx, "team", "full");
  const { agentId } = agentRefInput.parse(raw);
  const agent = await findAgent(ctx, agentId);
  const chat = ctx.chat;
  if (chat && agent.chatwootBotId !== null) {
    const botId = agent.chatwootBotId;
    await inChatwoot(async () => {
      for (const inbox of await inboxAssignments(chat)) {
        if (inbox.botId === botId) await chat.api.setInboxAgentBot(inbox.id, null);
      }
    });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.agent.delete({ where: { id: agent.id } });
    await tx.employee.update({ where: { id: agent.employeeId }, data: { active: false } });
    await audit(tx, ctx, {
      action: "agent.deleted",
      entity: "Agent",
      entityId: agent.id,
      before: { name: agent.name },
    });
  });
  return { agentId: agent.id, deleted: true };
}
