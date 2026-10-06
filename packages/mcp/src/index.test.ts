import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, INSTRUCTIONS, SERVER_NAME } from "./index.js";

describe("createMcpServer", () => {
  it("initializes with the server name, version and house rules", async () => {
    const server = createMcpServer("test-1");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: "test-1" });
    expect(client.getInstructions()).toBe(INSTRUCTIONS);

    await client.close();
    await server.close();
  });
});
