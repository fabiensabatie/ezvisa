import type { Context } from "@ezvisa/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tool.js";
import { caseTools } from "./tools/cases.js";
import { clientTools, sessionTools } from "./tools/clients.js";
import { documentTools } from "./tools/documents.js";
import { reminderTools } from "./tools/reminders.js";
import { teamTools } from "./tools/team.js";
import { templateTools } from "./tools/templates.js";

export { runTool } from "./tool.js";

export const SERVER_NAME = "ezvisa";

/** House rules sent to every MCP client at initialization. */
export const INSTRUCTIONS = [
  "You are working in EzVisa, the case system of a visa agency at Chiang Mai Immigration, Thailand.",
  "Dates are calendar dates in Asia/Bangkok, written YYYY-MM-DD.",
  "Before writing anything about a client, confirm you have the right person by full name and date of birth.",
  "You may mark checklist items RECEIVED or FLAGGED. Only a person can mark an item VERIFIED or approve a pack.",
  "Every FLAGGED item needs a short reason a validator can act on, such as 'photo background is grey'.",
  "Never promise a client that an application will be approved.",
  "Call whoami first to learn your role. Tools your role cannot use are not listed.",
].join("\n");

export const ALL_TOOLS = [
  ...sessionTools,
  ...clientTools,
  ...caseTools,
  ...documentTools,
  ...templateTools,
  ...reminderTools,
  ...teamTools,
];

/**
 * Creates the EzVisa MCP server for one authenticated request. Only the tools
 * the actor's role can use are registered.
 */
export function createMcpServer(options: { version: string; ctx: Context }): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, options.ctx, ALL_TOOLS);
  return server;
}
