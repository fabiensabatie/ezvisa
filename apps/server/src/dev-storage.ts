import { extname } from "node:path";
import { LOCAL_STORAGE_PATH, type LocalDiskStorage } from "@ezvisa/core";
import express, { type NextFunction, type Request, type Response, type Router } from "express";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function keyOf(req: Request): string {
  const parts = req.params.key;
  return Array.isArray(parts) ? parts.join("/") : String(parts ?? "");
}

/**
 * Serves the signed links of LocalDiskStorage. Mounted only in development, when no
 * S3 bucket is configured. Like a bucket with a CORS rule, it accepts PUTs from the
 * dashboard's origin, which in development is Vite's port.
 */
export function devStorageRouter(storage: LocalDiskStorage, uploadOrigins: string[] = []): Router {
  const router = express.Router();
  const path = `${LOCAL_STORAGE_PATH}/{*key}`;

  const cors = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    if (origin && uploadOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "PUT");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Max-Age", "3000");
    }
    res.setHeader("Vary", "Origin");
    next();
  };

  router.options(path, cors, (_req, res) => {
    res.sendStatus(204);
  });

  router.get(path, async (req, res) => {
    const key = keyOf(req);
    if (!storage.verify("GET", key, String(req.query.expires), String(req.query.sig))) {
      res.status(403).send("Link expired or invalid.");
      return;
    }
    if ((await storage.size(key)) === null) {
      res.status(404).send("Not found.");
      return;
    }
    res.type(TYPES[extname(key).toLowerCase()] ?? "application/octet-stream");
    res.send(Buffer.from(await storage.get(key)));
  });

  router.put(path, cors, express.raw({ type: () => true, limit: "20mb" }), async (req, res) => {
    const key = keyOf(req);
    if (!storage.verify("PUT", key, String(req.query.expires), String(req.query.sig))) {
      res.status(403).send("Link expired or invalid.");
      return;
    }
    await storage.put(key, new Uint8Array(req.body as Buffer));
    res.sendStatus(200);
  });

  return router;
}
