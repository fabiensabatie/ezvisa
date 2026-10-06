import { ROLE_PRESETS } from "../permissions.js";
import { generateToken, hashToken, tokenLast4 } from "../tokens.js";
import { runWithDb } from "./cli.js";

// Idempotent. Creates roles, reminder rules, settings, the owner and the assistant.
// In production it never creates tokens: use token:create, which prints one once.

const isProduction = process.env.RAILWAY_ENVIRONMENT_NAME === "production";

if (isProduction && !process.env.SEED_OWNER_EMAIL) {
  console.error("In production, set SEED_OWNER_EMAIL to the owner's real email first.");
  process.exit(1);
}

const REMINDER_RULES = [
  {
    kind: "STAY_ENDS" as const,
    offsetsDays: [60, 30, 14, 7],
    messageTemplate:
      "Hi {first_name}, your permission to stay in Thailand ends on {deadline}, in {days_left} days. Reply here and we will start your extension. {agent_name}, EzVisa",
  },
  {
    kind: "REPORT_DUE" as const,
    offsetsDays: [14, 7, 2],
    messageTemplate:
      "Hi {first_name}, your 90-day report is due on {deadline}, in {days_left} days. Reply here and we will file it for you. {agent_name}, EzVisa",
  },
];

await runWithDb(async (db) => {
  const roles = new Map<string, string>();
  for (const preset of ROLE_PRESETS) {
    const role = await db.role.upsert({
      where: { name: preset.name },
      update: { description: preset.description, permissions: preset.permissions, isSystem: true },
      create: {
        name: preset.name,
        description: preset.description,
        permissions: preset.permissions,
        isSystem: true,
      },
    });
    roles.set(preset.name, role.id);
  }

  const ownerEmail = (process.env.SEED_OWNER_EMAIL || "namtarn@ezvisa.local").toLowerCase();
  const owner = await db.employee.upsert({
    where: { email: ownerEmail },
    update: {},
    create: { name: "Namtarn", email: ownerEmail, roleId: roles.get("Owner") ?? "" },
  });

  await db.employee.upsert({
    where: { email: "assistant@ezvisa.local" },
    update: {},
    create: {
      name: "Claude",
      email: "assistant@ezvisa.local",
      kind: "ASSISTANT",
      roleId: roles.get("Assistant (MCP)") ?? "",
    },
  });

  for (const rule of REMINDER_RULES) {
    await db.reminderRule.upsert({ where: { kind: rule.kind }, update: {}, create: rule });
  }

  await db.setting.upsert({
    where: { key: "theme.accent" },
    update: {},
    create: { key: "theme.accent", value: "#EC5F9E" },
  });

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
    `Seeded ${ROLE_PRESETS.length} roles, the owner, the assistant, ${REMINDER_RULES.length} reminder rules and the theme.`,
  );
});
