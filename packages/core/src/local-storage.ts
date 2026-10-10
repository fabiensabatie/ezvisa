import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Storage } from "./storage.js";

/** URL path under which the server exposes local storage in development. */
export const LOCAL_STORAGE_PATH = "/__dev-storage";

/**
 * Development-only storage on the local disk, for machines without an S3 service.
 * Upload and download links are signed with a per-process secret and expire, like
 * presigned S3 URLs. Never used in production.
 */
export class LocalDiskStorage implements Storage {
  private readonly secret = randomBytes(32);
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(root: string, baseUrl: string) {
    this.root = resolve(root);
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.pathFor(key))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private signature(method: string, key: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${method}\n${key}\n${expires}`).digest("hex");
  }

  private signedUrl(method: "GET" | "PUT", key: string, expiresInSeconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const path = key.split("/").map(encodeURIComponent).join("/");
    const sig = this.signature(method, key, expires);
    return `${this.baseUrl}${LOCAL_STORAGE_PATH}/${path}?expires=${expires}&sig=${sig}`;
  }

  async uploadUrl(key: string, _contentType: string, expiresInSeconds: number): Promise<string> {
    return this.signedUrl("PUT", key, expiresInSeconds);
  }

  async downloadUrl(key: string, _filename: string, expiresInSeconds: number): Promise<string> {
    return this.signedUrl("GET", key, expiresInSeconds);
  }

  /** Checks a link produced by uploadUrl or downloadUrl. */
  verify(method: "GET" | "PUT", key: string, expires: string, sig: string): boolean {
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
    const expected = Buffer.from(this.signature(method, key, expiresAt), "hex");
    const given = Buffer.from(sig, "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
