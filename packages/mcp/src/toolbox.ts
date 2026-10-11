import type {
  AgentToolbox,
  AgentToolContent,
  AgentToolOutcome,
  AgentToolSpec,
  Context,
  Permissions,
} from "@ezvisa/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ALL_TOOLS, INSTRUCTIONS } from "./catalog.js";
import { runTool, type ToolDef } from "./tool.js";

// biome-ignore lint/suspicious/noExplicitAny: tool definitions have heterogeneous input schemas.
type AnyTool = ToolDef<any>;

const schemas = new Map<string, AgentToolSpec["input_schema"]>();

/** The tool's input as JSON Schema, the way MCP clients receive it. */
function inputSchema(tool: AnyTool): AgentToolSpec["input_schema"] {
  let schema = schemas.get(tool.name);
  if (!schema) {
    const { $schema: _ignored, ...json } = z.toJSONSchema(tool.input, { io: "input" }) as Record<
      string,
      unknown
    >;
    schema = { ...json, type: "object" };
    schemas.set(tool.name, schema);
  }
  return schema;
}

const visible = (tool: AnyTool, permissions: Permissions) =>
  !tool.visibleTo || tool.visibleTo(permissions);

/** MCP content blocks as agent content: text, images and PDFs; anything else described. */
function toContent(result: CallToolResult): AgentToolContent[] {
  return result.content.map((block): AgentToolContent => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image")
      return { type: "image", mediaType: block.mimeType, data: block.data };
    if (
      block.type === "resource" &&
      "blob" in block.resource &&
      block.resource.mimeType === "application/pdf"
    ) {
      return { type: "document", mediaType: "application/pdf", data: block.resource.blob };
    }
    if (block.type === "resource" && "text" in block.resource) {
      return { type: "text", text: block.resource.text };
    }
    return { type: "text", text: `[${block.type} content not shown]` };
  });
}

/**
 * EzVisa's MCP tools for chat agents, run in this process: an agent sees and runs exactly
 * what an MCP token with its permissions would, with the same errors and the same audit.
 */
export function mcpToolbox(): AgentToolbox {
  return {
    instructions: INSTRUCTIONS,
    list(permissions) {
      return ALL_TOOLS.filter((t) => visible(t, permissions)).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: inputSchema(t),
      }));
    },
    async run(ctx: Context, name, input): Promise<AgentToolOutcome> {
      const tool = ALL_TOOLS.find((t) => t.name === name);
      if (!tool || !visible(tool, ctx.actor.permissions)) {
        return {
          content: [{ type: "text", text: `FORBIDDEN: ${name} is not available to this role.` }],
          isError: true,
        };
      }
      const result = await runTool(ctx, (c) => tool.run(c, tool.input.parse(input)));
      return { content: toContent(result), isError: result.isError === true };
    },
  };
}
