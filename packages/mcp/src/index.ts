import type { Context } from "@ezvisa/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_TOOLS, INSTRUCTIONS } from "./catalog.js";
import { registerTools } from "./tool.js";

export { ALL_TOOLS, INSTRUCTIONS } from "./catalog.js";
export { runTool } from "./tool.js";
export { mcpToolbox } from "./toolbox.js";

export const SERVER_NAME = "ezvisa";

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
