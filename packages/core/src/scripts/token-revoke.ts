import { parseArgs } from "node:util";
import { maskToken } from "../tokens.js";
import { runWithDb } from "./cli.js";

// Usage: pnpm token:revoke --id <token id>   (find ids with pnpm token:list)

const { values } = parseArgs({ options: { id: { type: "string" } } });

if (!values.id) {
  console.error("Usage: token:revoke --id <token id>");
  process.exit(1);
}

const tokenId = values.id;

await runWithDb(async (db) => {
  const token = await db.apiToken.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error(`No token with id ${tokenId}`);
  if (token.revokedAt) {
    console.log(`${maskToken(token.last4)} was already revoked.`);
    return;
  }

  const [, sessions] = await db.$transaction([
    db.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } }),
    db.session.deleteMany({ where: { tokenId } }),
  ]);
  console.log(`Revoked ${maskToken(token.last4)} and ended ${sessions.count} dashboard sessions.`);
});
