import type { AddressInfo } from "node:net";
import { agents as agentServices, ChatAgents, type Context, cases, clients } from "@ezvisa/core";
import {
  createTestActor,
  createTestContext,
  FakeChatwoot,
  fakeChatConnection,
  incomingWebhook,
  publishSampleTemplate,
  resetDatabase,
  ScriptedModel,
  signWebhook,
  TEST_NOW,
  testDatabaseUrl,
} from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { mcpToolbox } from "@ezvisa/mcp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const url = testDatabaseUrl();
const APP_URL = "https://ezvisa.example";

describe.skipIf(!url)("chat agents over the webhook, with the real MCP tools", () => {
  let db: Db;
  let chatwoot: FakeChatwoot;
  let model: ScriptedModel;
  let runtime: ChatAgents;
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    db = createDb(url as string);
    chatwoot = new FakeChatwoot();
    chatwoot.now = () => TEST_NOW;
    model = new ScriptedModel([]);
    const chat = fakeChatConnection(chatwoot);
    runtime = new ChatAgents({
      db,
      chat,
      model: () => model,
      toolbox: mcpToolbox(),
      storage: null,
      appUrl: APP_URL,
      now: () => TEST_NOW,
      debounceMs: 0,
      log: () => {},
    });
    const server = createApp({
      db,
      version: "test",
      now: () => TEST_NOW,
      publicUrl: APP_URL,
      chat,
      agents: runtime,
    }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
  });
  beforeEach(() => resetDatabase(db));

  function post(agentId: string, body: string, headers: Record<string, string>) {
    return fetch(`${base}/chat/webhook/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  }

  it("answers a signed message, using MCP tools on the identified client only", async () => {
    const owner: Context = {
      ...createTestContext(db, (await createTestActor(db, "Owner")).actor),
      appUrl: APP_URL,
      chat: fakeChatConnection(chatwoot),
    };
    await publishSampleTemplate(owner);
    const jo = await clients.createClient(owner, {
      fullName: "Jo Maupas",
      nationality: "FR",
      dateOfBirth: "1960-04-02",
    });
    const hans = await clients.createClient(owner, { fullName: "Hans Becker", nationality: "DE" });
    const joCase = await cases.createCase(owner, {
      clientId: jo.id,
      template: "retirement-extension",
    });
    const hansCase = await cases.createCase(owner, {
      clientId: hans.id,
      template: "retirement-extension",
    });
    const role = await db.role.findUniqueOrThrow({ where: { name: "Client agent" } });
    const agent = await agentServices.createAgent(owner, {
      name: "Client desk",
      audience: "CLIENTS",
      roleId: role.id,
    });
    await agentServices.setAgentInboxes(owner, { agentId: agent.id, inboxIds: [1] });
    const secret = chatwoot.bots[0]?.secret as string;

    const conversation = chatwoot.addConversation({ id: 3, contact: { id: 30 }, text: "Hi" });
    const body = incomingWebhook(conversation, "Hi");
    const forged = signWebhook("guess", body, TEST_NOW);
    const refused = await post(agent.id, body, {
      "X-Chatwoot-Signature": forged.signature,
      "X-Chatwoot-Timestamp": forged.timestamp,
    });
    expect(refused.status).toBe(401);

    model = new ScriptedModel([
      { tool: "check_identity", input: { full_name: "Jo Maupas", date_of_birth: "1960-04-02" } },
      { tool: "get_case", input: { case: joCase.number } },
      { tool: "get_case", input: { case: hansCase.number } },
      { text: "Your case is getting started." },
    ]);
    const { signature, timestamp } = signWebhook(secret, body, TEST_NOW);
    const res = await post(agent.id, body, {
      "X-Chatwoot-Signature": signature,
      "X-Chatwoot-Timestamp": timestamp,
      "X-Chatwoot-Delivery": "delivery-1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    await runtime.idle();

    // The real get_case tool answered for Jo's case, and was never run for Hans's.
    expect(model.toolResultsOf(2)[0]).toMatchObject({
      number: joCase.number,
      client: { id: jo.id },
    });
    expect(model.toolResultsOf(3)[0]).toBe("That is not one of this client's records.");
    // The agent was offered MCP tools as JSON Schema, scoped to what a client agent may use.
    const offered = model.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(offered).toEqual(
      expect.arrayContaining(["check_identity", "get_case", "list_templates"]),
    );
    expect(offered).not.toContain("list_clients");
    expect(model.requests[0]?.tools.find((t) => t.name === "get_case")?.input_schema).toMatchObject(
      {
        type: "object",
        properties: { case: { type: "string" } },
      },
    );
    expect(chatwoot.botMessages(3).map((m) => m.content)).toEqual([
      "Your case is getting started.",
    ]);
  });
});
