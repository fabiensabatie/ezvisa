import { type Context, clients, MemoryStorage } from "@ezvisa/core";
import {
  createTestActor,
  createTestContext,
  publishSampleTemplate,
  resetDatabase,
  testDatabaseUrl,
} from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_TOOLS, createMcpServer, INSTRUCTIONS, SERVER_NAME } from "./index.js";

const url = testDatabaseUrl();

describe("tool catalogue", () => {
  it("has unique snake_case names and a description for every tool", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe.skipIf(!url)("MCP server", () => {
  let db: Db;
  const storage = new MemoryStorage();
  const open: Array<() => Promise<void>> = [];

  async function connect(ctx: Context) {
    const server = createMcpServer({ version: "test-1", ctx });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    open.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  const as = async (role: string) =>
    createTestContext(db, (await createTestActor(db, role)).actor, { storage });

  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    const data: unknown = result.isError ? null : result.structuredContent;
    return { result, text, data };
  }

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    storage.objects.clear();
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((close) => close()));
  });

  it("initializes with the server name and house rules", async () => {
    const client = await connect(await as("Owner"));
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: "test-1" });
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it("lists only the tools a role can use", async () => {
    const names = async (role: string) =>
      (await (await connect(await as(role))).listTools()).tools.map((t) => t.name);

    const owner = await names("Owner");
    expect(owner).toHaveLength(ALL_TOOLS.length);

    const assistant = await names("Assistant (MCP)");
    expect(assistant).toContain("update_case_item");
    expect(assistant).toContain("read_document");
    for (const hidden of [
      "list_tokens",
      "list_employees",
      "delete_client",
      "delete_document",
      "create_template",
    ]) {
      expect(assistant).not.toContain(hidden);
    }

    const runner = await names("Runner");
    expect(runner).toContain("close_case");
    expect(runner).not.toContain("update_case_item");
    expect(runner).not.toContain("create_client");
  });

  it("publishes every input schema as a JSON object schema", async () => {
    const { tools } = await (await connect(await as("Owner"))).listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("runs a case from intake to a blocked submission, as the assistant", async () => {
    const owner = await as("Owner");
    await publishSampleTemplate(owner);
    const assistant = await connect(await as("Assistant (MCP)"));

    const me = await call(assistant, "whoami");
    expect(me.data).toMatchObject({ role: "Assistant (MCP)", kind: "ASSISTANT" });

    const created = await call(assistant, "create_client", {
      fullName: "Hans Becker",
      nationality: "DE",
      dateOfBirth: "1958-04-02",
      stayUntil: "2026-11-03",
      consentGiven: true,
    });
    const clientId = (created.data as { id: string }).id;

    const opened = await call(assistant, "create_case", {
      clientId,
      template: "retirement-extension",
      dueDate: "2026-10-21",
    });
    const kase = opened.data as { number: string; items: Array<{ id: string; label: string }> };
    expect(kase.number).toBe("EZ-1000");

    const photo = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const uploaded = await call(assistant, "upload_document", {
      clientId,
      filename: "photo.png",
      mimeType: "image/png",
      contentBase64: photo,
      caseItemId: kase.items[2]?.id,
    });
    const documentId = (uploaded.data as { id: string }).id;

    const read = await call(assistant, "read_document", { documentId });
    expect(read.result.content.some((c) => c.type === "image")).toBe(true);

    const flagged = await call(assistant, "update_case_item", {
      case: kase.number,
      itemId: kase.items[2]?.id,
      status: "FLAGGED",
      note: "Photo background is grey, the office wants white",
    });
    expect(flagged.result.isError).toBeFalsy();

    const verify = await call(assistant, "update_case_item", {
      case: kase.number,
      itemId: kase.items[0]?.id,
      status: "VERIFIED",
    });
    expect(verify.result.isError).toBe(true);
    expect(verify.text).toMatch(/^FORBIDDEN: Only a person can mark an item VERIFIED/);

    const stage = await call(assistant, "move_case_stage", {
      case: kase.number,
      stage: "VALIDATION",
    });
    expect(stage.result.isError).toBe(true);
    expect(stage.text).toMatch(/^GUARD_FAILED: Cannot move EZ-1000 to VALIDATION/);
  });

  it("reports invalid input and missing records as tool errors", async () => {
    const client = await connect(await as("Owner"));
    const missing = await call(client, "get_case", { case: "EZ-9999" });
    expect(missing.result.isError).toBe(true);
    expect(missing.text).toMatch(/^NOT_FOUND/);

    const bad = await call(client, "create_client", { fullName: "", nationality: "Germany" });
    expect(bad.result.isError).toBe(true);
  });

  it("lists deadlines and renders reminders", async () => {
    const owner = await as("Owner");
    await clients.createClient(owner, {
      fullName: "Chen Wei",
      nationality: "CN",
      stayUntil: "2026-10-27",
    });
    const client = await connect(owner);
    const deadlines = await call(client, "list_deadlines", { withinDays: 30 });
    expect((deadlines.data as { items: unknown[] }).items).toHaveLength(1);
    const reminders = await call(client, "list_reminders", {});
    const first = (reminders.data as { items: Array<{ message: string; status: string }> })
      .items[0];
    expect(first).toMatchObject({ status: "DUE" });
    expect(first?.message).toContain("Hi Chen");
  });
});
