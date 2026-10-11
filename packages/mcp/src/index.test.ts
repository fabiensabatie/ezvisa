import { type Context, cases, clients, MemoryStorage, templates } from "@ezvisa/core";
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

  it("adds a large template file through an upload link, without base64", async () => {
    const owner = await as("Owner");
    const published = await publishSampleTemplate(owner);
    const formItem = published.published?.items[0];
    const client = await connect(owner);
    const size = 25 * 1024 * 1024;

    const link = await call(client, "create_template_file_upload", {
      template: "retirement-extension",
      filename: "TM7 scan.pdf",
      mimeType: "application/pdf",
      sizeBytes: size,
    });
    const upload = link.data as { uploadKey: string; uploadUrl: string; curl: string };
    expect(link.result.isError).toBeFalsy();
    expect(upload.curl).toContain('-H "Content-Type: application/pdf" --upload-file');
    expect(upload.curl).toContain(upload.uploadUrl);

    // What the curl PUT does: the bytes land in the bucket under the uploadKey.
    await storage.put(upload.uploadKey, new Uint8Array(size), "application/pdf");
    const confirmed = await call(client, "confirm_template_file_upload", {
      template: "retirement-extension",
      uploadKey: upload.uploadKey,
      name: "TM.7 application",
      kind: "PDF_FORM",
      mimeType: "application/pdf",
      itemId: formItem?.id,
    });
    const draft = (
      confirmed.data as {
        draft: {
          files: Array<{ id: string; sizeBytes: number }>;
          items: Array<{ formFileId: string | null }>;
        };
      }
    ).draft;
    expect(draft.files).toEqual([expect.objectContaining({ sizeBytes: size })]);
    expect(draft.items[0]?.formFileId).toBe(draft.files[0]?.id);

    const tooBig = await call(client, "create_template_file_upload", {
      template: "retirement-extension",
      filename: "huge.pdf",
      mimeType: "application/pdf",
      sizeBytes: 201 * 1024 * 1024,
    });
    expect(tooBig.result.isError).toBe(true);

    const runner = await connect(await as("Runner"));
    const runnerTools = (await runner.listTools()).tools.map((t) => t.name);
    expect(runnerTools).not.toContain("create_template_file_upload");
  });

  it("finds a case's blank form and hands it over, to save or to read", async () => {
    const owner = await as("Owner");
    await publishSampleTemplate(owner);
    const items = (await templates.getTemplate(owner, { template: "retirement-extension" }))
      .selected.items;
    await templates.attachTemplateFile(owner, {
      template: "retirement-extension",
      name: "TM.7 application",
      kind: "PDF_FORM",
      filename: "tm7.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("%PDF-1.7 blank TM.7").toString("base64"),
      itemId: items[0]?.id,
    });
    await templates.publishTemplateVersion(owner, { template: "retirement-extension" });
    const person = await clients.createClient(owner, { fullName: "Jo Maupas", nationality: "FR" });
    const kase = await cases.createCase(owner, {
      clientId: person.id,
      template: "retirement-extension",
    });

    // The assistant, working on the case, finds the form behind the first checklist item.
    const assistant = await connect(await as("Assistant (MCP)"));
    const detail = (await call(assistant, "get_case", { case: kase.number })).data as {
      forms: Array<{ id: string; name: string }>;
      items: Array<{ formFileId: string | null }>;
    };
    const formId = detail.items[0]?.formFileId;
    expect(detail.forms.map((f) => f.name)).toEqual(["TM.7 application"]);
    expect(formId).toBe(detail.forms[0]?.id);

    const saved = await call(assistant, "get_template_file", {
      fileId: formId,
      case: kase.number,
      download: true,
    });
    expect(saved.data).toMatchObject({ filename: "TM.7 application.pdf" });
    expect((saved.data as { curl: string }).curl).toMatch(
      /^curl --fail -o "TM\.7 application\.pdf"/,
    );

    const read = await call(assistant, "read_template_file", { fileId: formId, case: kase.number });
    const pdf = read.result.content.find((c) => c.type === "resource");
    expect(pdf).toMatchObject({
      resource: {
        mimeType: "application/pdf",
        blob: Buffer.from("%PDF-1.7 blank TM.7").toString("base64"),
      },
    });
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
