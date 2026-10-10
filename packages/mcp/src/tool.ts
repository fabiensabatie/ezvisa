import { type Context, hasLevel, isDomainError, type Permissions } from "@ezvisa/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError, type z } from "zod";

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

/** A tool that wants to return its own content blocks, e.g. a file. */
export type RawResult = { raw: CallToolResult };

export type ToolDef<S extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  /** Hide the tool from roles that could never use it. */
  visibleTo?: (permissions: Permissions) => boolean;
  run: (ctx: Context, input: z.infer<S>) => Promise<unknown>;
};

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const canView =
  (resource: Parameters<typeof hasLevel>[1]) =>
  (p: Permissions): boolean =>
    hasLevel(p, resource, "view");
export const canEdit =
  (resource: Parameters<typeof hasLevel>[1]) =>
  (p: Permissions): boolean =>
    hasLevel(p, resource, "edit");
export const canAdminister =
  (resource: Parameters<typeof hasLevel>[1]) =>
  (p: Permissions): boolean =>
    hasLevel(p, resource, "full");

function isRaw(value: unknown): value is RawResult {
  return typeof value === "object" && value !== null && "raw" in value;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Turns a service result or error into an MCP tool result. */
export async function runTool(
  ctx: Context,
  run: (ctx: Context) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const result = await run(ctx);
    if (isRaw(result)) return result.raw;
    const structured =
      typeof result === "object" && result !== null && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { result };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: structured,
    };
  } catch (error) {
    if (isDomainError(error)) return errorResult(`${error.code}: ${error.message}`);
    if (error instanceof ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
      return errorResult(`VALIDATION: ${issues.join("; ")}`);
    }
    console.error(JSON.stringify({ level: "error", msg: "tool failed", error: String(error) }));
    return errorResult("INTERNAL: Something went wrong on the server. The error was logged.");
  }
}

// biome-ignore lint/suspicious/noExplicitAny: tool definitions have heterogeneous input schemas.
export function registerTools(server: McpServer, ctx: Context, tools: ToolDef<any>[]): string[] {
  const registered: string[] = [];
  for (const tool of tools) {
    if (tool.visibleTo && !tool.visibleTo(ctx.actor.permissions)) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
      },
      ((args: unknown) => runTool(ctx, (c) => tool.run(c, args))) as never,
    );
    registered.push(tool.name);
  }
  return registered;
}
