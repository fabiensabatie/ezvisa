import {
  authenticateToken,
  bearerToken,
  type Context,
  hashToken,
  type Storage,
} from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import { createMcpServer } from "@ezvisa/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { createRateLimiter } from "./rate-limit.js";

export type McpRouteOptions = {
  db: Db;
  storage: Storage | null;
  version: string;
  now?: () => Date;
  /** Requests per minute per token (or per IP without a token). */
  rateLimit?: number;
};

function jsonRpcError(res: Response, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/**
 * POST /mcp, stateless Streamable HTTP. Every request is authenticated from its bearer
 * token and gets its own MCP server scoped to that actor's role.
 */
export function mcpRouter(options: McpRouteOptions): Router {
  const now = options.now ?? (() => new Date());
  const allow = createRateLimiter(options.rateLimit ?? 120, 60_000);
  const router = express.Router();

  router.post("/mcp", express.json({ limit: "15mb" }), async (req: Request, res: Response) => {
    const token = bearerToken(req.header("authorization"));
    const key = token ? `token:${hashToken(token)}` : `ip:${req.ip}`;
    if (!allow(key)) {
      res.setHeader("Retry-After", "60");
      jsonRpcError(res, 429, -32000, "Too many requests. Wait a minute and retry.");
      return;
    }

    let ctx: Context;
    try {
      const actor = await authenticateToken(options.db, token ?? "", now());
      ctx = { actor, via: "MCP", db: options.db, storage: options.storage, now };
    } catch {
      res.setHeader("WWW-Authenticate", 'Bearer realm="ezvisa"');
      jsonRpcError(
        res,
        401,
        -32001,
        "Unauthorized: the access token is missing, invalid or revoked.",
      );
      return;
    }

    const server = createMcpServer({ version: options.version, ctx });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(
        JSON.stringify({ level: "error", msg: "mcp request failed", error: String(error) }),
      );
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  // Stateless server: no SSE stream to open and no session to delete.
  router.all("/mcp", (_req, res) => {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, -32000, "Method not allowed. This MCP server is stateless: use POST.");
  });

  return router;
}
