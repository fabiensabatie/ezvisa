import { ROLE_PRESETS } from "../permissions.js";
import { REMINDER_RULES, seedBase } from "../seed-base.js";
import { generateToken, hashToken, tokenLast4 } from "../tokens.js";
import { runWithDb } from "./cli.js";

// Idempotent. Creates roles, reminder rules, settings, the owner and the assistant.
// In production it never creates tokens: use token:create, which prints one once.

const isProduction = process.env.RAILWAY_ENVIRONMENT_NAME === "production";

if (isProduction && !process.env.SEED_OWNER_EMAIL) {
  console.error("In production, set SEED_OWNER_EMAIL to the owner's real email first.");
  process.exit(1);
}

await runWithDb(async (db) => {
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || "namtarn@ezvisa.local").toLowerCase();
  const { owner } = await seedBase(db, { email: ownerEmail, name: "Namtarn" });

  const activeTokens = await db.apiToken.count({
    where: { employeeId: owner.id, revokedAt: null },
  });
  const fixedToken = process.env.SEED_OWNER_TOKEN?.trim();

  if (isProduction) {
    console.log(`Production: no token created. Run token:create --employee ${ownerEmail}.`);
  } else if (fixedToken) {
    const hash = hashToken(fixedToken);
    await db.apiToken.upsert({
      where: { hash },
      update: {},
      create: { employeeId: owner.id, label: "Seed token", hash, last4: tokenLast4(fixedToken) },
    });
    console.log(`Seed owner token from SEED_OWNER_TOKEN is ready for ${ownerEmail}.`);
  } else if (activeTokens === 0) {
    const token = generateToken();
    await db.apiToken.create({
      data: {
        employeeId: owner.id,
        label: "Seed token",
        hash: hashToken(token),
        last4: tokenLast4(token),
      },
    });
    console.log(`Created a token for ${ownerEmail}. It is shown once:\n\n  ${token}\n`);
  }

  console.log(
    `Seeded ${ROLE_PRESETS.length} roles, the owner, the assistant, ${REMINDER_RULES.length} reminder rules and settings.`,
  );
});
