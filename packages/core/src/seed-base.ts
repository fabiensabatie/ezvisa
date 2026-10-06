import type { Db } from "@ezvisa/db";
import { ROLE_PRESETS } from "./permissions.js";

export const REMINDER_RULES = [
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

export const ASSISTANT_EMAIL = "assistant@ezvisa.local";

/**
 * Idempotent base data every environment needs: roles, reminder rules, settings,
 * the owner and the assistant. Never creates tokens.
 */
export async function seedBase(db: Db, owner: { email: string; name: string }) {
  const roleIds = new Map<string, string>();
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
    roleIds.set(preset.name, role.id);
  }

  const ownerRow = await db.employee.upsert({
    where: { email: owner.email.toLowerCase() },
    update: {},
    create: {
      name: owner.name,
      email: owner.email.toLowerCase(),
      roleId: roleIds.get("Owner") ?? "",
    },
  });

  const assistant = await db.employee.upsert({
    where: { email: ASSISTANT_EMAIL },
    update: {},
    create: {
      name: "Claude",
      email: ASSISTANT_EMAIL,
      kind: "ASSISTANT",
      roleId: roleIds.get("Assistant (MCP)") ?? "",
    },
  });

  for (const rule of REMINDER_RULES) {
    await db.reminderRule.upsert({ where: { kind: rule.kind }, update: {}, create: rule });
  }

  for (const [key, value] of [
    ["theme.accent", "#EC5F9E"],
    ["agent.name", owner.name],
  ] as const) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  return { roleIds, owner: ownerRow, assistant };
}
