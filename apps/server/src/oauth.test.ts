import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MemoryStorage, team } from "@ezvisa/core";
import {
  createTestActor,
  createTestContext,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const url = testDatabaseUrl();
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a-long-enough-pkce-verifier-for-the-test-0123456789abcdef";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

/** Response bodies in these tests are flat JSON objects. */
type Body = Record<string, string | string[] | undefined>;
const json = async (res: Response) => (await res.json()) as Body;
const text = (value: Body[string]) => String(value);

describe.skipIf(!url)("OAuth for MCP connectors", () => {
  let db: Db;
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    db = createDb(url as string);
    // The issuer is the server's own origin, known only once it listens.
    let app: Express | undefined;
    const server = createServer((req, res) => app?.(req, res));
    server.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app = createApp({
      db,
      version: "test",
      storage: new MemoryStorage(),
      now: () => TEST_NOW,
      secureCookies: false,
      loginRateLimit: 1000,
      publicUrl: base,
    });
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
  });
  beforeEach(() => resetDatabase(db));

  async function register(body: Record<string, unknown> = {}) {
    return fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], ...body }),
    });
  }

  async function signIn(role = "Owner") {
    const { token, actor } = await createTestActor(db, role, { name: "Namtarn K." });
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return { cookie, actor, token };
  }

  function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
    return new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "xyz",
      resource: `${base}/mcp`,
      ...extra,
    });
  }

  async function consent(clientId: string, cookie: string, decision: "allow" | "deny") {
    const page = await fetch(`${base}/authorize?${authorizeQuery(clientId)}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const form = authorizeQuery(clientId, { csrf, decision });
    return fetch(`${base}/authorize`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual",
    });
  }

  async function token(params: Record<string, string>) {
    return fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  }

  /** Registers a client and runs the whole browser flow up to the first tokens. */
  async function connect() {
    const client = (await (await register()).json()) as { client_id: string };
    const { cookie, actor } = await signIn();
    const approved = await consent(client.client_id, cookie, "allow");
    const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const res = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      resource: `${base}/mcp`,
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token: string; refresh_token: string };
    return { clientId: client.client_id, actor, tokens, code };
  }

  async function mcp(accessToken: string) {
    return fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    });
  }

  it("advertises the authorization server from /mcp's 401 and the metadata documents", async () => {
    const unauthorized = await mcp("");
    expect(unauthorized.status).toBe(401);
    const challenge = unauthorized.headers.get("www-authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBe(`${base}/.well-known/oauth-protected-resource/mcp`);

    const resource = await json(await fetch(metadataUrl as string));
    expect(resource).toMatchObject({ resource: `${base}/mcp`, scopes_supported: ["mcp"] });

    const issuer = String(resource.authorization_servers?.[0]);
    const server = await (
      await fetch(new URL("/.well-known/oauth-authorization-server", issuer))
    ).json();
    expect(server).toMatchObject({
      issuer,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("registers public clients only and refuses unsafe redirect URIs", async () => {
    const res = await register({ token_endpoint_auth_method: "client_secret_post" });
    expect(res.status).toBe(201);
    const info = await json(res);
    expect(info.client_id).toBeTruthy();
    expect(info.client_secret).toBeUndefined();
    expect(info.token_endpoint_auth_method).toBe("none");

    expect((await register({ redirect_uris: ["http://evil.example/cb"] })).status).toBe(400);
    expect((await register({ redirect_uris: ["http://localhost:8765/callback"] })).status).toBe(
      201,
    );
  });

  it("sends signed-out people to the dashboard sign-in, then back to the consent page", async () => {
    const client = await json(await register());
    const res = await fetch(`${base}/authorize?${authorizeQuery(text(client.client_id))}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", base);
    expect(location.pathname).toBe("/login");
    const next = location.searchParams.get("next") ?? "";
    expect(next.startsWith("/authorize?")).toBe(true);
    expect(new URLSearchParams(next.split("?")[1]).get("client_id")).toBe(text(client.client_id));
  });

  it("shows who is connecting and refuses a forged consent", async () => {
    const client = await json(await register());
    const { cookie } = await signIn();
    const page = await fetch(`${base}/authorize?${authorizeQuery(text(client.client_id))}`, {
      headers: { Cookie: cookie },
    });
    const html = await page.text();
    expect(html).toContain("Connect Claude to EzVisa?");
    expect(html).toContain("claude.ai");
    expect(page.headers.get("x-frame-options")).toBe("DENY");

    const forged = await fetch(`${base}/authorize`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: authorizeQuery(text(client.client_id), { csrf: "guess", decision: "allow" }),
      redirect: "manual",
    });
    expect(forged.status).toBe(403);
    expect(await db.oAuthCode.count()).toBe(0);
  });

  it("returns access_denied when the person cancels", async () => {
    const client = await json(await register());
    const { cookie } = await signIn();
    const res = await consent(text(client.client_id), cookie, "deny");
    const location = new URL(res.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("refuses tokens for another resource", async () => {
    const client = await json(await register());
    const { cookie } = await signIn();
    const res = await fetch(
      `${base}/authorize?${authorizeQuery(text(client.client_id), { resource: "https://other.example/mcp" })}`,
      { headers: { Cookie: cookie }, redirect: "manual" },
    );
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  it("issues tokens that work on /mcp as the approving employee", async () => {
    const { tokens, actor, clientId } = await connect();
    expect(tokens.access_token.startsWith("ezv_at_")).toBe(true);
    expect(tokens.refresh_token.startsWith("ezv_rt_")).toBe(true);

    const client = new Client({ name: "connector", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();

    // The grant is a token of the employee who approved, listed in Settings.
    const grant = await db.apiToken.findFirstOrThrow({ where: { oauthClientId: clientId } });
    expect(grant.employeeId).toBe(actor.employeeId);
    expect(grant.label).toBe("Claude");
    const audit = await db.auditLog.findFirst({
      where: { action: "token.created", entityId: grant.id },
    });
    expect(audit?.actorId).toBe(actor.employeeId);
  });

  it("accepts each code once and checks the PKCE verifier", async () => {
    const { clientId, code } = await connect();
    const reuse = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
    });
    expect(reuse.status).toBe(400);
    expect((await json(reuse)).error).toBe("invalid_grant");

    const { cookie } = await signIn();
    const approved = await consent(clientId, cookie, "allow");
    const second = new URL(approved.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const wrong = await token({
      grant_type: "authorization_code",
      code: second,
      code_verifier: `${VERIFIER}-wrong`,
      client_id: clientId,
    });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe("invalid_grant");
  });

  it("rotates refresh tokens", async () => {
    const { clientId, tokens } = await connect();
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const next = await json(refreshed);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(text(next.access_token))).status).toBe(200);

    const replay = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(replay.status).toBe(400);
  });

  it("cuts the connector off when its token is revoked in Settings", async () => {
    const { clientId, tokens, actor } = await connect();
    expect((await mcp(tokens.access_token)).status).toBe(200);

    const grant = await db.apiToken.findFirstOrThrow({ where: { oauthClientId: clientId } });
    await team.revokeToken(createTestContext(db, actor, { via: "DASHBOARD" }), {
      tokenId: grant.id,
    });

    const refused = await mcp(tokens.access_token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    const refresh = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(refresh.status).toBe(400);
  });

  it("does not accept connector tokens for the dashboard", async () => {
    const { tokens } = await connect();
    for (const value of [tokens.access_token, tokens.refresh_token]) {
      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      expect(res.status).toBe(401);
    }
    expect((await mcp(tokens.refresh_token)).status).toBe(401);
  });
});
