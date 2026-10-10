import type { AddressInfo } from "node:net";
import { MemoryStorage } from "@ezvisa/core";
import { createTestActor, resetDatabase, TEST_NOW, testDatabaseUrl } from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("POST /mcp", () => {
  let db: Db;
  let base: string;
  let close: () => Promise<void>;
  const clients: Client[] = [];

  beforeAll(async () => {
    db = createDb(url as string);
    const app = createApp({
      db,
      version: "test",
      storage: new MemoryStorage(),
      now: () => TEST_NOW,
      mcpRateLimit: 30,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
  });
  beforeEach(() => resetDatabase(db));
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  async function connect(token: string) {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "curl", version: "0" },
    },
  };

  it("refuses requests without a valid token", async () => {
    for (const authorization of [undefined, "Bearer ezv_live_notarealtokennotarealtoken"]) {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify(initialize),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    }
  });

  it("answers GET with 405 because the server is stateless", async () => {
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
  });

  it("serves the role's tools and runs them as the token's employee", async () => {
    const { token } = await createTestActor(db, "Owner", { name: "Namtarn" });
    const client = await connect(token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("create_case");

    const me = await client.callTool({ name: "whoami", arguments: {} });
    expect(me.structuredContent).toMatchObject({ name: "Namtarn", role: "Owner" });

    const created = await client.callTool({
      name: "create_client",
      arguments: { fullName: "Priya Nair", nationality: "IN", stayUntil: "2026-10-20" },
    });
    expect(created.isError).toBeFalsy();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "client.created" } });
    expect(audit.via).toBe("MCP");
  });

  it("stops accepting a token as soon as it is revoked", async () => {
    const { token, actor } = await createTestActor(db, "Validator");
    const client = await connect(token);
    await client.listTools();
    await db.apiToken.update({ where: { id: actor.tokenId }, data: { revokedAt: new Date() } });
    await expect(client.listTools()).rejects.toThrow();
  });

  it("rate-limits each token", async () => {
    const { token } = await createTestActor(db, "Runner");
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(initialize),
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(30);
    expect(statuses.slice(-2)).toEqual([429, 429]);
  });
});
