import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import { createAgent, setAgentInboxes } from "../services/agents.js";
import { createCase } from "../services/cases.js";
import { linkTeamMember } from "../services/chat.js";
import { createClient } from "../services/clients.js";
import type { PushMessage, PushSender, PushTarget } from "../services/notifications.js";
import { MemoryStorage } from "../storage.js";
import {
  createTestActor,
  createTestContext,
  FakeChatwoot,
  FakeToolbox,
  fakeChatConnection,
  incomingWebhook,
  publishSampleTemplate,
  resetDatabase,
  ScriptedModel,
  signWebhook,
  TEST_NOW,
  testDatabaseUrl,
} from "../testing.js";
import type { ChatModel } from "./model.js";
import { ChatAgents, RESUMED_NOTE } from "./runtime.js";

const url = testDatabaseUrl();
const APP_URL = "https://ezvisa.example";

class RecordingPush implements PushSender {
  sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  async publicKey() {
    return "key";
  }
  async send(target: PushTarget, message: PushMessage) {
    this.sent.push({ target, message });
    return "sent" as const;
  }
}

describe.skipIf(!url)("chat agents", () => {
  let db: Db;
  let owner: Context;
  let chatwoot: FakeChatwoot;
  let toolbox: FakeToolbox;
  let push: RecordingPush;
  let clock: Date;
  const storage = new MemoryStorage();

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    clock = TEST_NOW;
    chatwoot = new FakeChatwoot();
    chatwoot.now = () => clock;
    chatwoot.inboxList.push({ id: 2, name: "Team LINE group", channel_type: "Channel::Line" });
    toolbox = new FakeToolbox();
    push = new RecordingPush();
    const actor = (await createTestActor(db, "Owner", { name: "Namtarn" })).actor;
    owner = {
      ...createTestContext(db, actor, { storage }),
      now: () => clock,
      appUrl: APP_URL,
      chat: fakeChatConnection(chatwoot),
    };
  });

  /** An agent answering one inbox: clients in inbox 1, the team in inbox 2. */
  async function agentFor(audience: "CLIENTS" | "TEAM", roleName: string) {
    const role = await db.role.findUniqueOrThrow({ where: { name: roleName } });
    const name = audience === "CLIENTS" ? "Client desk" : "Team helper";
    const { id } = await createAgent(owner, { name, audience, roleId: role.id });
    await setAgentInboxes(owner, { agentId: id, inboxIds: [audience === "CLIENTS" ? 1 : 2] });
    const agent = await db.agent.findUniqueOrThrow({ where: { id } });
    const bot = chatwoot.bots.find((b) => b.id === agent.chatwootBotId);
    return { id, secret: bot?.secret as string };
  }

  function agents(model: ChatModel | null) {
    return new ChatAgents({
      db,
      chat: fakeChatConnection(chatwoot),
      model: () => model,
      toolbox,
      storage,
      push,
      appUrl: APP_URL,
      now: () => clock,
      debounceMs: 0,
      log: () => {},
    });
  }

  /** Jo Maupas, born 2 April 1960, and Hans Becker, each with an open case. */
  async function twoClients() {
    await publishSampleTemplate(owner);
    const jo = await createClient(owner, {
      fullName: "Jo Maupas",
      nationality: "FR",
      dateOfBirth: "1960-04-02",
      phone: "+66 81 234 5678",
      consentGiven: true,
    });
    const hans = await createClient(owner, { fullName: "Hans Becker", nationality: "DE" });
    const joCase = await createCase(owner, { clientId: jo.id, template: "retirement-extension" });
    const hansCase = await createCase(owner, {
      clientId: hans.id,
      template: "retirement-extension",
    });
    return { jo, hans, joCase, hansCase };
  }

  it("routes each webhook to its agent and answers only signed ones", async () => {
    const { id, secret } = await agentFor("CLIENTS", "Client agent");
    const runtime = agents(new ScriptedModel([]));
    const conversation = chatwoot.addConversation({ id: 7, contact: { id: 70 }, text: "Hello" });
    const body = incomingWebhook(conversation, "Hello");

    expect(
      (await runtime.receive("no-such-agent", body, signWebhook(secret, body, clock))).status,
    ).toBe(404);
    expect((await runtime.receive(id, body, signWebhook("wrong", body, clock))).status).toBe(401);
    const stale = signWebhook(secret, body, new Date(clock.getTime() - 10 * 60_000));
    expect((await runtime.receive(id, body, stale)).status).toBe(401);
    const signed = (b: string) => signWebhook(secret, b, clock);
    expect(await runtime.receive(id, body, { ...signed(body), delivery: "d1" })).toEqual({
      status: 200,
      queued: true,
    });
    expect((await runtime.receive(id, body, { ...signed(body), delivery: "d1" })).queued).toBe(
      false,
    );
    const outgoing = JSON.stringify({ ...JSON.parse(body), message_type: "outgoing" });
    expect((await runtime.receive(id, outgoing, signed(outgoing))).queued).toBe(false);
  });

  it("works through MCP tools on the identified client's records only", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    const { jo, hansCase, joCase } = await twoClients();
    chatwoot.addConversation({
      id: 8,
      contact: { id: 80, name: "Jojo" },
      text: "Where is my case?",
    });
    const model = new ScriptedModel([
      { tool: "get_case", input: { case: joCase.number } },
      { tool: "check_identity", input: { full_name: "maupas  JO", date_of_birth: "1960-04-02" } },
      { tool: "get_case", input: { case: hansCase.number } },
      { tool: "list_clients", input: {} },
      { tool: "list_cases", input: { clientId: hansCase.client.id } },
      { tool: "create_client_upload_link", input: { case: joCase.number } },
      { text: "Here is your private upload link." },
    ]);

    const result = await agents(model).process(id, 8);
    expect(result).toMatchObject({ outcome: "replied", handedOff: false });
    const results = model.requests.slice(1).map((_, i) => model.toolResultsOf(i + 1)[0]);
    // Before the identity check, nothing about a case.
    expect(results[0]).toContain("not identified");
    expect(results[1]).toMatchObject({ identified: true, clientId: jo.id });
    // Someone else's case, and the list of every client, stay out of reach.
    expect(results[2]).toBe("That is not one of this client's records.");
    expect(results[3]).toBe("list_clients is not available to Client desk.");
    // A list is filtered to the identified client whatever the model asked.
    expect(toolbox.calls.find((c) => c.name === "list_cases")?.input).toMatchObject({
      clientId: jo.id,
    });
    expect(results[5]).toMatchObject({
      url: expect.stringMatching(/^https:\/\/ezvisa\.example\/upload#/),
    });

    expect(chatwoot.botMessages(8).map((m) => m.content)).toEqual([
      "Here is your private upload link.",
    ]);
    expect(chatwoot.contactAttributes.get(80)).toEqual({
      ezvisa_client: `${APP_URL}/clients/${jo.id}`,
    });
    const actions = await db.auditLog.findMany({ where: { via: "CHAT" }, orderBy: { id: "asc" } });
    expect(actions.map((a) => a.action)).toEqual([
      "chat.contact_linked",
      "case.upload_link_created",
      "chat.replied",
    ]);
    const link = await db.caseShareLink.findFirstOrThrow({ include: { case: true } });
    expect(link.case.clientId).toBe(jo.id);
  });

  it("locks the identity check after three failures", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    await twoClients();
    chatwoot.addConversation({ id: 9, contact: { id: 90 }, text: "I am Jo Maupas" });
    const wrong = { full_name: "Jo Maupas", date_of_birth: "1961-04-02" };
    const model = new ScriptedModel([
      { tool: "check_identity", input: wrong },
      { tool: "check_identity", input: wrong },
      { tool: "check_identity", input: wrong },
      { tool: "check_identity", input: { full_name: "Jo Maupas", date_of_birth: "1960-04-02" } },
      { text: "I cannot check that." },
    ]);
    await agents(model).process(id, 9);
    const results = [1, 2, 3, 4].map((i) => model.toolResultsOf(i)[0] as Record<string, unknown>);
    expect(results.slice(0, 3).map((r) => r.attemptsLeft)).toEqual([2, 1, 0]);
    expect(results[3]).toMatchObject({ identified: false, locked: true });
  });

  it("hands over with a note and a notification that opens the EzVisa inbox", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    const validator = (await createTestActor(db, "Validator")).actor;
    await db.pushSubscription.create({
      data: {
        employeeId: validator.employeeId,
        endpoint: "https://push.example/1",
        p256dh: "p",
        auth: "a",
      },
    });
    chatwoot.addConversation({
      id: 10,
      contact: { id: 100 },
      text: "How much is a retirement visa?",
    });
    const model = new ScriptedModel([
      { tool: "hand_to_team", input: { reason: "asks for a price", summary: "Wants a quote." } },
      { text: "Someone from the agency will reply soon." },
    ]);
    await agents(model).process(id, 10);
    expect(chatwoot.status(10)).toBe("open");
    expect(chatwoot.botMessages(10, { private: true })[0]?.content).toContain(
      "Client desk handed this to the team: asks for a price",
    );
    expect(push.sent[0]?.message).toMatchObject({ url: "/inbox/10" });
    expect(JSON.stringify(push.sent[0]?.message)).not.toContain("retirement");
  });

  it("steps back when a person answers, and answers again once handed back", async () => {
    const { id, secret } = await agentFor("CLIENTS", "Client agent");
    chatwoot.addConversation({ id: 11, contact: { id: 110 }, text: "Hello?" });
    chatwoot.teamWrites(11, "Hi, Namtarn here.");
    chatwoot.clientWrites(11, "Great, thanks");
    const model = new ScriptedModel([{ text: "Happy to help." }]);
    const runtime = agents(model);

    expect(await runtime.process(id, 11)).toEqual({
      outcome: "skipped",
      reason: "a person is answering",
    });
    expect(chatwoot.status(11)).toBe("open");

    await chatwoot.setStatus(11, "pending");
    const changed = JSON.stringify({
      event: "conversation_status_changed",
      id: 11,
      status: "pending",
    });
    await runtime.receive(id, changed, signWebhook(secret, changed, clock));
    expect(chatwoot.botMessages(11, { private: true }).map((m) => m.content)).toEqual([
      RESUMED_NOTE,
    ]);
    clock = new Date(clock.getTime() + 1000);
    chatwoot.clientWrites(11, "One more question");
    expect(await runtime.process(id, 11)).toMatchObject({ outcome: "replied" });
  });

  it("hands over at once without a model, and stays quiet when paused or switched off", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    chatwoot.addConversation({ id: 12, contact: { id: 120 }, text: "Hello" });
    await db.agent.update({ where: { id }, data: { enabled: false } });
    expect(await agents(null).process(id, 12)).toMatchObject({ outcome: "skipped" });
    await db.agent.update({ where: { id }, data: { enabled: true } });
    expect(await agents(null).process(id, 12)).toMatchObject({ outcome: "handed_off" });
    expect(chatwoot.status(12)).toBe("open");
  });

  it("links a WhatsApp number to the one client who has it", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    const { jo } = await twoClients();
    chatwoot.addConversation({
      id: 13,
      contact: { id: 130, phone_number: "+66812345678" },
      channel: "Channel::Whatsapp",
      text: "Status?",
    });
    const model = new ScriptedModel([{ text: "Let me check." }]);
    await agents(model).process(id, 13);
    expect(model.requests[0]?.context).toContain(
      `linked to the client Jo Maupas (clientId ${jo.id})`,
    );
  });

  it("answers the team only for linked people, with no more than their own permissions", async () => {
    const { id } = await agentFor("TEAM", "Assistant (MCP)");
    const { joCase } = await twoClients();
    const runner = (await createTestActor(db, "Runner", { name: "Somchai" })).actor;
    const teamChat = chatwoot.addConversation({
      id: 20,
      contact: { id: 200, name: "Somchai" },
      text: "Mark the passport received",
    });
    teamChat.inbox_id = 2;

    const idle = new ScriptedModel([]);
    expect(await agents(idle).process(id, 20)).toEqual({
      outcome: "skipped",
      reason: "unknown team member",
    });
    expect(chatwoot.botMessages(20)[0]?.content).toContain("not linked to anyone");
    expect(idle.requests).toHaveLength(0);

    await linkTeamMember(owner, { conversationId: 20, employeeId: runner.employeeId });
    chatwoot.clientWrites(20, "Mark the passport received please");
    const item = joCase.items[0] as { id: string };
    const model = new ScriptedModel([
      { tool: "get_case", input: { case: joCase.number } },
      {
        tool: "update_case_item",
        input: { case: joCase.number, itemId: item.id, status: "RECEIVED" },
      },
      { text: "I can read the case but your role cannot change it." },
    ]);
    await agents(model).process(id, 20);
    expect(model.requests[0]?.context).toContain("talking with Somchai (Runner)");
    // The agent's role could edit cases; the runner's cannot, so neither can the agent here.
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain("update_case_item");
    expect(model.toolResultsOf(1)[0]).toMatchObject({ number: joCase.number });
    expect(model.toolResultsOf(2)[0]).toBe("update_case_item is not available to Team helper.");
    expect((await db.caseItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      "MISSING",
    );
  });
  it("takes a new client from their first message to their checklist", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    await publishSampleTemplate(owner);
    chatwoot.addConversation({
      id: 30,
      contact: { id: 300, name: "Mia" },
      text: "Hi, I need my retirement extension",
    });
    const newClientId = (m: ScriptedModel) => (m.toolResultsOf(2)[0] as { id: string }).id;
    const caseNumberOf = (m: ScriptedModel) => (m.toolResultsOf(4)[0] as { number: string }).number;
    const mia = {
      fullName: "Mia Tanaka",
      nationality: "JP",
      dateOfBirth: "1985-06-15",
      passportNo: "TK1234567",
      consentGiven: true,
    };
    const model = new ScriptedModel([
      { tool: "create_client", input: { fullName: "Mia Tanaka", nationality: "JP" } },
      { tool: "create_client", input: mia },
      { tool: "list_templates", input: {} },
      {
        tool: "create_case",
        input: (m) => ({
          clientId: newClientId(m),
          template: "retirement-extension",
          assigneeId: owner.actor.employeeId,
        }),
      },
      {
        tool: "create_case",
        input: (m) => ({ clientId: newClientId(m), template: "retirement-extension" }),
      },
      { tool: "create_client_upload_link", input: (m) => ({ case: caseNumberOf(m) }) },
      { text: "Welcome Mia! Here is your checklist to upload your documents." },
    ]);

    expect(await agents(model).process(id, 30)).toMatchObject({
      outcome: "replied",
      handedOff: false,
    });
    // A new client needs a date of birth, for identity checks later.
    expect(model.toolResultsOf(1)[0]).toContain("date of birth");
    const client = await db.client.findUniqueOrThrow({ where: { id: newClientId(model) } });
    // From the chat: the channel is known, but no passport number and no consent on their behalf.
    expect(client).toMatchObject({
      fullName: "Mia Tanaka",
      channel: "LINE",
      passportNo: null,
      consentAt: null,
    });
    expect((await db.chatContact.findUniqueOrThrow({ where: { chatwootId: 300 } })).clientId).toBe(
      client.id,
    );
    expect(model.requests[3]?.context).toContain("linked to the client Mia Tanaka");

    const kase = await db.case.findFirstOrThrow({
      where: { clientId: client.id },
      include: { items: true },
    });
    expect(kase.assigneeId).toBeNull();
    expect(kase.items.length).toBeGreaterThan(0);
    // One open case per service: the second is refused and the agent is told to share the first.
    expect(model.toolResultsOf(5)[0]).toContain(
      `EZ-${kase.number} is already open for Retirement extension`,
    );
    expect(model.toolResultsOf(6)[0]).toMatchObject({ url: expect.stringContaining("/upload#") });

    expect(chatwoot.botMessages(30, { private: true }).map((m) => m.content)).toEqual([
      "Client desk created the client Mia Tanaka from this conversation.",
      `Client desk opened EZ-${kase.number} (Retirement extension) for Mia Tanaka.`,
      expect.stringMatching(
        new RegExp(
          `^Client desk shared the checklist for EZ-${kase.number}; the link works until \\d{4}-\\d{2}-\\d{2}\\.$`,
        ),
      ),
    ]);
    const actions = (
      await db.auditLog.findMany({ where: { via: "CHAT" }, orderBy: { id: "asc" } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "client.created",
        "chat.contact_linked",
        "case.created",
        "case.upload_link_created",
      ]),
    );
  });

  it("never registers someone twice, and keeps a client's identity out of the chat's reach", async () => {
    const { id } = await agentFor("CLIENTS", "Client agent");
    const { jo } = await twoClients();
    chatwoot.addConversation({ id: 31, contact: { id: 310 }, text: "I am new here, Jo Maupas" });
    const twice = new ScriptedModel([
      {
        tool: "create_client",
        input: { fullName: "MAUPAS Jo", nationality: "FR", dateOfBirth: "1960-04-02" },
      },
      { text: "Let me check who you are first." },
    ]);
    await agents(twice).process(id, 31);
    expect(twice.toolResultsOf(1)[0]).toContain("already exists");
    expect(
      await db.client.count({ where: { fullName: { contains: "Maupas", mode: "insensitive" } } }),
    ).toBe(1);

    chatwoot.addConversation({ id: 32, contact: { id: 320 }, text: "New phone number" });
    const update = new ScriptedModel([
      { tool: "check_identity", input: { full_name: "Jo Maupas", date_of_birth: "1960-04-02" } },
      {
        tool: "create_client",
        input: { fullName: "Jo Again", nationality: "FR", dateOfBirth: "1990-01-01" },
      },
      {
        tool: "update_client",
        input: {
          clientId: jo.id,
          fullName: "Someone Else",
          dateOfBirth: "1999-09-09",
          phone: "+66 99 999 9999",
        },
      },
      { text: "Your number is updated." },
    ]);
    await agents(update).process(id, 32);
    expect(update.toolResultsOf(2)[0]).toContain("already linked to a client");
    expect(await db.client.findUniqueOrThrow({ where: { id: jo.id } })).toMatchObject({
      fullName: "Jo Maupas",
      phone: "+66 99 999 9999",
    });
    expect(
      (await db.client.findUniqueOrThrow({ where: { id: jo.id } })).dateOfBirth?.toISOString(),
    ).toContain("1960-04-02");
  });
});
