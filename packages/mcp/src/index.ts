import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_NAME = "ezvisa";

/** House rules sent to every MCP client at initialization. */
export const INSTRUCTIONS = [
  "You are working in EzVisa, the case system of a visa agency at Chiang Mai Immigration, Thailand.",
  "Dates are calendar dates in Asia/Bangkok, written YYYY-MM-DD.",
  "Before writing anything about a client, confirm you have the right person by full name and date of birth.",
  "You may mark checklist items RECEIVED or FLAGGED. Only a person can mark an item VERIFIED or approve a pack.",
  "Every FLAGGED item needs a short reason a validator can act on, such as 'photo background is grey'.",
  "Never promise a client that an application will be approved.",
].join("\n");

/**
 * Creates the EzVisa MCP server. Tools are registered here in M1; the factory takes
 * the version so the transport layer can report the deployed build.
 */
export function createMcpServer(version: string): McpServer {
  return new McpServer({ name: SERVER_NAME, version }, { instructions: INSTRUCTIONS });
}
