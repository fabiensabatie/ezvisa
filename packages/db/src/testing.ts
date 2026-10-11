import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Applies every migration to the database at `url`. Used by test global setups. */
export function migrateDatabase(url: string): void {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const prismaCli = fileURLToPath(
    new URL("../node_modules/prisma/build/index.js", import.meta.url),
  );
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Every table, children first. Used to reset the test database between tests. */
export const ALL_TABLES = [
  "AuditLog",
  "Reminder",
  "ReminderRule",
  "Setting",
  "Document",
  "CaseItem",
  "CaseShareLink",
  "Case",
  "TemplateItem",
  "TemplateFile",
  "TemplateVersion",
  "Template",
  "Agent",
  "ChatContact",
  "Client",
  "Session",
  "OAuthAccessToken",
  "OAuthCode",
  "ApiToken",
  "OAuthClient",
  "PushSubscription",
  "Employee",
  "Role",
] as const;
