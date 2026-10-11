import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ChatAgents,
  type ChatConnection,
  LOCAL_STORAGE_PATH,
  LocalDiskStorage,
  type PushSender,
  type Storage,
} from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { authRouter, dashboardActor } from "./auth.js";
import { devStorageRouter } from "./dev-storage.js";
import { mcpRouter } from "./mcp.js";
import { oauthRouter, resourceMetadataUrl } from "./oauth.js";
import { appRouter } from "./router.js";

export type AppOptions = {
  db: Db;
  version: string;
  /** Document storage. Null when no bucket is configured. */
  storage?: Storage | null;
  /** Sends Web Push notifications. Null turns notifications off. */
  push?: PushSender | null;
  /** Built dashboard to serve. Omitted in development, where Vite serves it. */
  webDir?: string;
  now?: () => Date;
  mcpRateLimit?: number;
  loginRateLimit?: number;
  /** Defaults to true in production. Secure cookies need HTTPS. */
  secureCookies?: boolean;
  /** Dashboard origins allowed to PUT to local storage links (development only). */
  uploadOrigins?: string[];
  /**
   * The public origin people and connectors reach, e.g. https://app.example.com. Enables
   * OAuth for MCP connectors; without it, /mcp accepts personal tokens only.
   */
  publicUrl?: string;
  /** The shared inbox (Chatwoot). Null turns the chat features off. */
  chat?: ChatConnection | null;
  /** The agents answering in the shared inbox. Chatwoot calls /chat/webhook/:agentId. */
  agents?: ChatAgents | null;
};

const API_PREFIXES = [
  "/trpc",
  "/auth",
  "/mcp",
  "/chat",
  "/health",
  "/.well-known",
  LOCAL_STORAGE_PATH,
];
/** OAuth endpoints served by the MCP SDK at the root. */
const API_PATHS = new Set(["/authorize", "/token", "/register", "/revoke"]);

export function createApp({
  db,
  version,
  webDir,
  storage = null,
  push = null,
  now = () => new Date(),
  mcpRateLimit,
  loginRateLimit,
  secureCookies = process.env.NODE_ENV === "production",
  uploadOrigins = [],
  publicUrl,
  chat = null,
  agents = null,
}: AppOptions): Express {
  const origin = publicUrl?.replace(/\/+$/, "");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get("/health", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "ok", version });
    } catch {
      res.status(503).json({ status: "error", database: "unreachable", version });
    }
  });

  // Chatwoot signs each webhook over the exact bytes it sent, so the body stays raw text.
  app.post(
    "/chat/webhook/:agentId",
    express.text({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      if (!agents) {
        res.status(404).json({ error: "Chat agents are not configured." });
        return;
      }
      try {
        const raw = typeof req.body === "string" ? req.body : "";
        const result = await agents.receive(String(req.params.agentId), raw, {
          signature: req.get("x-chatwoot-signature"),
          timestamp: req.get("x-chatwoot-timestamp"),
          delivery: req.get("x-chatwoot-delivery"),
        });
        res.status(result.status).json({ queued: result.queued });
      } catch (error) {
        console.log(
          JSON.stringify({ level: "error", msg: "chat webhook failed", error: String(error) }),
        );
        // A 500 makes Chatwoot retry, which is what a passing failure deserves.
        res.status(500).json({ error: "Could not handle the webhook." });
      }
    },
  );

  app.use(authRouter({ db, now, secureCookies, loginRateLimit }));
  if (origin) app.use(oauthRouter({ db, publicUrl: origin, now }));
  app.use(
    mcpRouter({
      db,
      storage,
      version,
      now,
      rateLimit: mcpRateLimit,
      resourceMetadataUrl: origin ? resourceMetadataUrl(origin) : undefined,
      ...(origin ? { appUrl: origin } : {}),
      chat,
    }),
  );
  if (storage instanceof LocalDiskStorage) app.use(devStorageRouter(storage, uploadOrigins));

  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      async createContext({ req, res }) {
        const actor = await dashboardActor({ db, now, secureCookies }, req, res);
        return {
          requestId: randomUUID(),
          db,
          storage,
          push,
          now,
          actor,
          ip: req.ip ?? "",
          appUrl: origin ?? null,
          chat,
        };
      },
    }),
  );

  if (webDir && existsSync(join(webDir, "index.html"))) {
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders(res, path) {
          // Vite fingerprints everything under /assets, so it can be cached forever.
          if (/[\\/]assets[\\/]/.test(path)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    // Single-page app: unknown non-API paths return index.html.
    const canonical = origin ? new URL(origin) : null;
    app.get("/{*path}", (req, res, next) => {
      if (API_PATHS.has(req.path) || API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        return next();
      }
      // Pages live on the public address only. Someone on another host (the Railway domain)
      // is sent there, so sign-in, browser uploads and links share one origin. APIs, MCP
      // and webhooks are left alone: connectors and Chatwoot may still call the old host.
      const local = req.hostname === "localhost" || req.hostname === "127.0.0.1";
      if (canonical && !local && req.hostname !== canonical.hostname) {
        res.redirect(308, new URL(req.originalUrl, canonical).toString());
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      // `root` keeps the dot-file check on the relative path only, so a checkout under a
      // dot-folder (such as .claude/worktrees) still serves the page.
      res.sendFile("index.html", { root: webDir });
    });
  }

  return app;
}
