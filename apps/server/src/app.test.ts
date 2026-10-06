import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AppOptions, createApp } from "./app.js";

type Running = { url: string; close: () => Promise<void> };
const running: Running[] = [];

async function start(options: AppOptions): Promise<string> {
  const server = createApp(options).listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  running.push({
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  });
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.close()));
});

const healthyDb = { $queryRaw: (async () => [{ ok: 1 }]) as unknown } as AppOptions["db"];
const brokenDb = {
  $queryRaw: (async () => {
    throw new Error("connection refused");
  }) as unknown,
} as AppOptions["db"];

describe("GET /health", () => {
  it("returns 200 when the database answers", async () => {
    const url = await start({ db: healthyDb, version: "test" });
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok", version: "test" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const url = await start({ db: brokenDb, version: "test" });
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error", database: "unreachable" });
  });
});

describe("tRPC", () => {
  it("answers the health query", async () => {
    const url = await start({ db: healthyDb, version: "test" });
    const res = await fetch(`${url}/trpc/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { ok: boolean; service: string } } };
    expect(body.result.data).toMatchObject({ ok: true, service: "ezvisa" });
  });
});

describe("dashboard hosting", () => {
  it("serves index.html for app routes but not for API paths", async () => {
    // The parent folder starts with a dot, like a .claude/worktrees checkout.
    const parent = mkdtempSync(join(tmpdir(), ".ezvisa-"));
    const webDir = join(parent, "web");
    mkdirSync(join(webDir, "assets"), { recursive: true });
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>EzVisa</title>");
    writeFileSync(join(webDir, "assets", "app-abc123.js"), "console.log(1)");
    const url = await start({ db: healthyDb, version: "test", webDir });

    for (const path of ["/", "/cases/EZ-1042"]) {
      const page = await fetch(`${url}${path}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-cache");
      expect(await page.text()).toContain("<title>EzVisa</title>");
    }

    const asset = await fetch(`${url}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const api = await fetch(`${url}/trpc/does-not-exist`);
    expect(api.status).toBe(404);
  });
});
