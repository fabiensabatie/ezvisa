import { createHash, timingSafeEqual } from "node:crypto";
import {
  ACCESS_TOKEN_PREFIX,
  type Actor,
  authenticateSession,
  generateToken,
  hashToken,
  REFRESH_TOKEN_PREFIX,
  SESSION_COOKIE,
  tokenLast4,
} from "@ezvisa/core";
import type { Db, Prisma } from "@ezvisa/db";
import {
  AccessDeniedError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Request, RequestHandler, Response } from "express";
import { readCookie } from "./cookies.js";

/**
 * OAuth 2.1 for MCP connectors such as claude.ai, which cannot send a static bearer token.
 * The MCP SDK's router serves the protocol endpoints (metadata, /register, /authorize,
 * /token, /revoke); this file stores clients, codes and tokens, and shows the consent page.
 *
 * An approved connector gets a grant, stored as an ApiToken of the approving employee, so
 * it appears under Settings → Tokens and is revoked like any other token.
 */

export const OAUTH_SCOPE = "mcp";
const ACCESS_TOKEN_SECONDS = 60 * 60;
const GRANT_DAYS = 90;
const CODE_SECONDS = 5 * 60;
const MAX_LABEL = 80;

export type OAuthOptions = {
  db: Db;
  /** The public origin, e.g. https://app.example.com. Issuer of every token. */
  publicUrl: string;
  now: () => Date;
};

/** The MCP endpoint: the protected resource tokens are issued for. */
export function mcpResourceUrl(publicUrl: string): string {
  return `${publicUrl}/mcp`;
}

/** Where /mcp's 401 points clients to discover the authorization server (RFC 9728). */
export function resourceMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/.well-known/oauth-protected-resource/mcp`;
}

function sameResource(a: string, b: string): boolean {
  const clean = (s: string) => s.replace(/#.*$/, "").replace(/\/$/, "");
  return clean(a) === clean(b);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "about:",
  "blob:",
]);

/** HTTPS anywhere, HTTP on loopback only (RFC 8252), or an app's private-use scheme. */
function acceptableRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return !FORBIDDEN_SCHEMES.has(url.protocol);
}

/** Ties the consent form to the signed-in session, so another site cannot submit it. */
function consentCsrf(sessionId: string): string {
  return createHash("sha256").update(`oauth-consent:${sessionId}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The /authorize query, rebuilt from validated parameters, to come back to after sign-in. */
function authorizePath(client: OAuthClientInformationFull, params: AuthorizationParams): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });
  if (params.state !== undefined) query.set("state", params.state);
  if (params.scopes?.length) query.set("scope", params.scopes.join(" "));
  if (params.resource) query.set("resource", params.resource.href);
  return `/authorize?${query}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clientName(client: OAuthClientInformationFull): string | null {
  const name = client.client_name?.trim();
  return name ? name.slice(0, MAX_LABEL) : null;
}

/** Where the browser goes after the decision. Shown so a look-alike app is easy to spot. */
function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.host || `${url.protocol}//`;
}

function page(title: string, body: string): string {
  // The default Sakura palette from @ezvisa/ui, which the server does not bundle.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · EzVisa</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    background: #fef7fa; color: #381d2b; font: 16px/1.5 Nunito, system-ui, sans-serif; }
  main { width: 100%; max-width: 30rem; background: #fff; border: 1px solid #fce2ee;
    border-radius: 32px; padding: 36px 32px 32px;
    box-shadow: 0 2px 6px rgba(236,95,158,0.10), 0 24px 60px rgba(236,95,158,0.18); }
  .brand { font-weight: 700; font-size: 1.25rem; color: #9e426b; }
  h1 { font-family: Fredoka, Nunito, system-ui, sans-serif; font-weight: 600; font-size: 1.75rem;
    line-height: 1.2; margin: 24px 0 8px; overflow-wrap: anywhere; }
  p { margin: 8px 0; color: #6a4256; }
  ul { margin: 16px 0; padding: 14px 18px 14px 34px; background: #fce9f1; border-radius: 16px;
    color: #6a4256; }
  li + li { margin-top: 6px; }
  strong { color: #381d2b; overflow-wrap: anywhere; }
  .who { font-size: 0.9rem; color: #865d72; }
  .actions { display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }
  button { flex: 1 1 10rem; min-height: 52px; border-radius: 999px; font: inherit;
    font-weight: 800; cursor: pointer; border: 2px solid #9e426b; }
  .allow { background: #9e426b; color: #fff; }
  .deny { background: #fff; color: #9e426b; }
  button:focus-visible { outline: 3px solid #ec5f9e; outline-offset: 2px; }
</style>
</head>
<body><main><div class="brand">EzVisa</div>${body}</main></body>
</html>`;
}

function sendPage(res: Response, status: number, title: string, body: string): void {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.send(page(title, body));
}

function consentPage(
  res: Response,
  actor: Actor,
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  csrf: string,
): void {
  const name = clientName(client);
  const app = escapeHtml(name ?? "An unnamed app");
  const target = escapeHtml(redirectTarget(params.redirectUri));
  const hidden: Record<string, string> = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    csrf,
  };
  if (params.state !== undefined) hidden.state = params.state;
  if (params.scopes?.length) hidden.scope = params.scopes.join(" ");
  if (params.resource) hidden.resource = params.resource.href;
  const fields = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("");

  sendPage(
    res,
    200,
    "Connect an app",
    `<h1>Connect ${app} to EzVisa?</h1>
<p class="who">Signed in as <strong>${escapeHtml(actor.name)}</strong> (${escapeHtml(actor.roleName)}).</p>
<ul>
  <li>It will use the EzVisa tools <strong>as you</strong>, with the permissions of your role.</li>
  <li>Its actions are recorded in the audit log under your name.</li>
  <li>You can disconnect it at any time from Settings → Tokens.</li>
</ul>
<p>After you choose, you go back to <strong>${target}</strong>. Only allow this if you just started connecting EzVisa from that app yourself.</p>
<form method="post" action="/authorize">${fields}
  <div class="actions">
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
    <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
  </div>
</form>`,
  );
}

function tokenResponse(accessToken: string, refreshToken: string): OAuthTokens {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    scope: OAUTH_SCOPE,
  };
}

export function createOAuthProvider({ db, publicUrl, now }: OAuthOptions): OAuthServerProvider {
  const resource = mcpResourceUrl(publicUrl);

  function checkResource(value: URL | string | undefined | null): void {
    if (value && !sameResource(String(value), resource)) {
      throw new InvalidTargetError(`This server only issues tokens for ${resource}.`);
    }
  }

  function accessTokenExpiry(at: Date): Date {
    return new Date(at.getTime() + ACCESS_TOKEN_SECONDS * 1000);
  }

  function grantExpiry(at: Date): Date {
    return new Date(at.getTime() + GRANT_DAYS * 86_400_000);
  }

  return {
    clientsStore: {
      async getClient(clientId) {
        const row = await db.oAuthClient.findUnique({ where: { id: clientId } });
        return row ? (row.metadata as unknown as OAuthClientInformationFull) : undefined;
      },

      async registerClient(client) {
        if (!client.redirect_uris.every((uri) => acceptableRedirectUri(String(uri)))) {
          throw new InvalidClientMetadataError(
            "redirect_uris must use https, http on localhost, or an app's own scheme.",
          );
        }
        // Public clients only: drop any generated secret. PKCE protects the code exchange.
        const { client_secret: _secret, client_secret_expires_at: _expires, ...rest } = client;
        const info = {
          ...rest,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        } as OAuthClientInformationFull;
        await db.oAuthClient.create({
          data: {
            id: info.client_id,
            name: clientName(info),
            redirectUris: info.redirect_uris.map(String),
            metadata: JSON.parse(JSON.stringify(info)) as Prisma.InputJsonValue,
          },
        });
        return info;
      },
    },

    async authorize(client, params, res) {
      checkResource(params.resource);
      const req = res.req as Request;

      const sessionId = readCookie(req.header("cookie"), SESSION_COOKIE) ?? "";
      const actor = sessionId
        ? await authenticateSession(db, sessionId, now()).catch(() => null)
        : null;
      if (!actor) {
        res.redirect(302, `/login?next=${encodeURIComponent(authorizePath(client, params))}`);
        return;
      }

      const csrf = consentCsrf(sessionId);
      const decision = req.method === "POST" ? req.body?.decision : undefined;
      if (decision === undefined) {
        consentPage(res, actor, client, params, csrf);
        return;
      }
      if (typeof req.body?.csrf !== "string" || !safeEqual(req.body.csrf, csrf)) {
        sendPage(
          res,
          403,
          "Request expired",
          "<h1>This request has expired.</h1><p>Go back to the app and start connecting EzVisa again.</p>",
        );
        return;
      }
      if (decision !== "allow") throw new AccessDeniedError("The request was declined.");

      const code = generateToken("");
      await db.oAuthCode.create({
        data: {
          hash: hashToken(code),
          clientId: client.client_id,
          employeeId: actor.employeeId,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          resource: params.resource?.href ?? null,
          expiresAt: new Date(now().getTime() + CODE_SECONDS * 1000),
        },
      });
      const target = new URL(params.redirectUri);
      target.searchParams.set("code", code);
      if (params.state !== undefined) target.searchParams.set("state", params.state);
      res.redirect(302, target.href);
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const row = await db.oAuthCode.findUnique({ where: { hash: hashToken(authorizationCode) } });
      if (!row || row.clientId !== client.client_id || row.expiresAt <= now()) {
        throw new InvalidGrantError("The authorization code is invalid or has expired.");
      }
      return row.codeChallenge;
    },

    async exchangeAuthorizationCode(client, authorizationCode, _verifier, redirectUri, target) {
      const at = now();
      const hash = hashToken(authorizationCode);
      const invalid = new InvalidGrantError("The authorization code is invalid or has expired.");
      const row = await db.oAuthCode.findUnique({
        where: { hash },
        include: { employee: true },
      });
      if (!row || row.clientId !== client.client_id || row.expiresAt <= at) throw invalid;
      // Single use: only the request that deletes the code may continue.
      const { count } = await db.oAuthCode.deleteMany({ where: { hash } });
      if (count !== 1) throw invalid;
      if (redirectUri !== undefined && redirectUri !== row.redirectUri) throw invalid;
      checkResource(target);
      if (!row.employee.active) throw invalid;

      const refreshToken = generateToken(REFRESH_TOKEN_PREFIX);
      const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
      const label = clientName(client) ?? "MCP connector";
      await db.$transaction(async (tx) => {
        const grant = await tx.apiToken.create({
          data: {
            employeeId: row.employeeId,
            label,
            hash: hashToken(refreshToken),
            last4: tokenLast4(refreshToken),
            oauthClientId: client.client_id,
            expiresAt: grantExpiry(at),
          },
        });
        await tx.oAuthAccessToken.create({
          data: {
            hash: hashToken(accessToken),
            tokenId: grant.id,
            expiresAt: accessTokenExpiry(at),
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: row.employeeId,
            via: "DASHBOARD",
            action: "token.created",
            entity: "ApiToken",
            entityId: grant.id,
            after: { employee: row.employee.name, label, connector: client.client_id },
          },
        });
      });
      return tokenResponse(accessToken, refreshToken);
    },

    async exchangeRefreshToken(client, refreshToken, _scopes, target) {
      const at = now();
      const invalid = new InvalidGrantError("The refresh token is invalid, expired or revoked.");
      if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) throw invalid;
      checkResource(target);
      const oldHash = hashToken(refreshToken);
      const grant = await db.apiToken.findUnique({
        where: { hash: oldHash },
        include: { employee: true },
      });
      if (
        !grant ||
        grant.oauthClientId !== client.client_id ||
        grant.revokedAt ||
        (grant.expiresAt && grant.expiresAt <= at) ||
        !grant.employee.active
      ) {
        throw invalid;
      }

      // Rotation: the old refresh token stops working once the new one is issued.
      const nextRefresh = generateToken(REFRESH_TOKEN_PREFIX);
      const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
      await db.$transaction(async (tx) => {
        const { count } = await tx.apiToken.updateMany({
          where: { id: grant.id, hash: oldHash, revokedAt: null },
          data: {
            hash: hashToken(nextRefresh),
            last4: tokenLast4(nextRefresh),
            expiresAt: grantExpiry(at),
          },
        });
        if (count !== 1) throw invalid;
        await tx.oAuthAccessToken.create({
          data: {
            hash: hashToken(accessToken),
            tokenId: grant.id,
            expiresAt: accessTokenExpiry(at),
          },
        });
      });
      return tokenResponse(accessToken, nextRefresh);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const row = token.startsWith(ACCESS_TOKEN_PREFIX)
        ? await db.oAuthAccessToken.findUnique({
            where: { hash: hashToken(token) },
            include: { token: true },
          })
        : null;
      if (!row || row.expiresAt <= now() || row.token.revokedAt || !row.token.oauthClientId) {
        throw new InvalidTokenError("The access token is invalid, expired or revoked.");
      }
      return {
        token,
        clientId: row.token.oauthClientId,
        scopes: [OAUTH_SCOPE],
        expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
        resource: new URL(resource),
      };
    },

    async revokeToken(client, { token }) {
      const hash = hashToken(token);
      if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
        await db.oAuthAccessToken.deleteMany({
          where: { hash, token: { oauthClientId: client.client_id } },
        });
      } else if (token.startsWith(REFRESH_TOKEN_PREFIX)) {
        const grant = await db.apiToken.findFirst({
          where: { hash, oauthClientId: client.client_id, revokedAt: null },
        });
        if (!grant) return;
        await db.$transaction([
          db.apiToken.update({ where: { id: grant.id }, data: { revokedAt: now() } }),
          db.oAuthAccessToken.deleteMany({ where: { tokenId: grant.id } }),
        ]);
      }
    },
  };
}

/**
 * Mounts the OAuth endpoints at the application root: /.well-known metadata, /register,
 * /authorize, /token and /revoke.
 */
export function oauthRouter(options: OAuthOptions): RequestHandler {
  return mcpAuthRouter({
    provider: createOAuthProvider(options),
    issuerUrl: new URL(options.publicUrl),
    resourceServerUrl: new URL(mcpResourceUrl(options.publicUrl)),
    scopesSupported: [OAUTH_SCOPE],
    resourceName: "EzVisa",
  });
}
