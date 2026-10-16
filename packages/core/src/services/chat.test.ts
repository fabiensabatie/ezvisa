import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import {
  createTestActor,
  createTestContext,
  FakeChatwoot,
  fakeChatConnection,
  resetDatabase,
  testDatabaseUrl,
} from "../testing.js";
import { createAgent, deleteAgent, listAgents, setAgentInboxes, updateAgent } from "./agents.js";
import {
  chatOverview,
  clientChats,
  getConversation,
  handConversation,
  linkChatContact,
  linkTeamMember,
  listConversations,
  markConversationRead,
  sendChatMessage,
  unlinkChatContact,
  updateChatSettings,
} from "./chat.js";
import { createClient } from "./clients.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("shared inbox and agents for the team", () => {
  let db: Db;
  let chatwoot: FakeChatwoot;
  let owner: Context;

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    chatwoot = new FakeChatwoot();
    chatwoot.inboxList.push({ id: 2, name: "WhatsApp", channel_type: "Channel::Whatsapp" });
    owner = await as("Owner");
  });

  async function as(role: string): Promise<Context> {
    const { actor } = await createTestActor(db, role, { name: `${role} person` });
    return {
      ...createTestContext(db, actor, { via: "DASHBOARD" }),
      appUrl: "https://ezvisa.example",
      chat: fakeChatConnection(chatwoot),
    };
  }

  it("creates agents, each with its own bot, team member and inboxes", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { name: "Client agent" } });
    const desk = await createAgent(owner, {
      name: "Client desk",
      audience: "CLIENTS",
      roleId: role.id,
    });
    const night = await createAgent(owner, {
      name: "Night shift",
      audience: "CLIENTS",
      roleId: role.id,
      model: "claude-haiku-4-5",
      instructions: "Answer briefly.",
    });
    expect(chatwoot.bots.map((b) => [b.name, b.outgoing_url])).toEqual([
      ["Client desk", `https://ezvisa.example/chat/webhook/${desk.id}`],
      ["Night shift", `https://ezvisa.example/chat/webhook/${night.id}`],
    ]);
    await setAgentInboxes(owner, { agentId: desk.id, inboxIds: [1, 2] });
    // An inbox has one agent: giving WhatsApp to the night shift moves it.
    await setAgentInboxes(owner, { agentId: night.id, inboxIds: [2] });
    await updateAgent(owner, { agentId: desk.id, name: "Day desk" });

    const listed = await listAgents(owner);
    expect(listed.agents.map((a) => [a.name, a.role.name, a.inboxIds])).toEqual([
      ["Day desk", "Client agent", [1]],
      ["Night shift", "Client agent", [2]],
    ]);
    expect(listed.inboxes.map((i) => [i.name, i.agentId])).toEqual([
      ["LINE OA", desk.id],
      ["WhatsApp", night.id],
    ]);
    expect(chatwoot.bots[0]?.name).toBe("Day desk");
    const employee = await db.employee.findFirstOrThrow({ where: { name: "Day desk" } });
    expect(employee.kind).toBe("ASSISTANT");

    await deleteAgent(owner, { agentId: night.id });
    expect(chatwoot.inboxBots.has(2)).toBe(false);
    expect((await db.employee.findFirstOrThrow({ where: { name: "Night shift" } })).active).toBe(
      false,
    );

    const validator = await as("Validator");
    await expect(
      createAgent(validator, { name: "Rogue", audience: "TEAM", roleId: role.id }),
    ).rejects.toThrow(/cannot/);
  });

  it("links a conversation to a client and answers it as a person", async () => {
    const client = await createClient(owner, { fullName: "Hans Becker", nationality: "DE" });
    chatwoot.addConversation({
      id: 5,
      contact: { id: 50, name: "Hans" },
      status: "pending",
      text: "Hallo",
    });

    await expect(sendChatMessage(owner, { clientId: client.id, text: "Hi" })).rejects.toThrow(
      /no conversation linked/,
    );
    const validator = await as("Validator");
    await linkChatContact(validator, { conversationId: 5, clientId: client.id });
    expect(chatwoot.contactAttributes.get(50)).toEqual({
      ezvisa_client: `https://ezvisa.example/clients/${client.id}`,
    });

    await sendChatMessage(validator, {
      conversationId: 5,
      text: "Checking with Namtarn",
      private: true,
    });
    expect(chatwoot.status(5)).toBe("pending");
    await sendChatMessage(validator, { clientId: client.id, text: "Your link: …" });
    // A person answering takes the conversation from the agent.
    expect(chatwoot.status(5)).toBe("open");

    const listed = await listConversations(validator, { status: "open" });
    expect(listed.items[0]).toMatchObject({
      id: 5,
      channel: "LINE",
      inbox: "LINE OA",
      unread: 1,
      client: { id: client.id, fullName: "Hans Becker" },
    });
    await markConversationRead(validator, { conversationId: 5 });
    expect((await listConversations(validator, { status: "open" })).items[0]?.unread).toBe(0);

    const conversation = await getConversation(validator, { conversationId: 5 });
    expect(conversation.client).toMatchObject({
      fullName: "Hans Becker",
      linkedBy: "team",
      cases: [],
    });
    expect(conversation.messages.map((m) => [m.from, m.private, m.text])).toEqual([
      ["contact", false, "Hallo"],
      ["team", true, "Checking with Namtarn"],
      ["team", false, "Your link: …"],
    ]);
    expect((await clientChats(validator, { clientId: client.id })).contacts[0]).toMatchObject({
      contactId: 50,
      linkedBy: "team",
    });

    await handConversation(validator, { conversationId: 5, to: "agent" });
    expect(chatwoot.status(5)).toBe("pending");
    await unlinkChatContact(validator, { contactId: 50 });
    expect(chatwoot.contactAttributes.get(50)).toEqual({ ezvisa_client: null });

    const runner = await as("Runner");
    await expect(sendChatMessage(runner, { conversationId: 5, text: "Hi" })).rejects.toThrow(
      /cannot/,
    );
  });

  it("calls a Twilio inbox WhatsApp or SMS from its medium", async () => {
    chatwoot.inboxList.push(
      { id: 3, name: "EzVisa WhatsApp", channel_type: "Channel::TwilioSms", medium: "whatsapp" },
      { id: 4, name: "EzVisa SMS", channel_type: "Channel::TwilioSms", medium: "sms" },
    );
    const conversation = chatwoot.addConversation({
      id: 7,
      contact: { id: 70, name: "Hans", phone_number: "+4915112345678" },
      channel: "Channel::TwilioSms",
      text: "Hallo",
    });
    conversation.inbox_id = 3;
    expect((await listAgents(owner)).inboxes.map((i) => i.channel)).toEqual([
      "LINE",
      "WhatsApp",
      "WhatsApp",
      "SMS",
    ]);
    const listed = await listConversations(owner, { status: "all" });
    expect(listed.items.find((c) => c.id === 7)).toMatchObject({
      channel: "WhatsApp",
      inbox: "EzVisa WhatsApp",
    });
    expect((await getConversation(owner, { conversationId: 7 })).channel).toBe("WhatsApp");
  });

  it("lets only owners say who on the team is writing", async () => {
    chatwoot.addConversation({ id: 6, contact: { id: 60, name: "Somchai" }, text: "Hi" });
    const runner = await as("Runner");
    const validator = await as("Validator");
    await expect(
      linkTeamMember(validator, { conversationId: 6, employeeId: runner.actor.employeeId }),
    ).rejects.toThrow(/cannot/);
    await linkTeamMember(owner, { conversationId: 6, employeeId: runner.actor.employeeId });
    expect((await getConversation(owner, { conversationId: 6 })).employee).toMatchObject({
      name: "Runner person",
    });
  });

  it("keeps the agency notes and the pause switch, and explains a missing connection", async () => {
    await updateChatSettings(owner, { instructions: "Open Mon–Fri 9:00–17:00.", enabled: false });
    expect(await chatOverview(owner)).toMatchObject({
      connection: { connected: true },
      enabled: false,
      instructions: "Open Mon–Fri 9:00–17:00.",
    });
    const offline = { ...owner, chat: null };
    await expect(listConversations(offline, {})).rejects.toThrow(/CHATWOOT_URL/);
    expect((await chatOverview(offline)).connection.connected).toBe(false);
  });
});
