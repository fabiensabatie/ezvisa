import { parseArgs } from "node:util";
import { generateToken, hashToken, tokenLast4 } from "../tokens.js";
import { findEmployee, runWithDb } from "./cli.js";

// Usage: pnpm token:create --employee <email|id> --label "Namtarn laptop" [--expires-days 365]

const { values } = parseArgs({
  options: {
    employee: { type: "string" },
    label: { type: "string" },
    "expires-days": { type: "string" },
  },
});

if (!values.employee || !values.label) {
  console.error('Usage: token:create --employee <email|id> --label "<label>" [--expires-days N]');
  process.exit(1);
}

const employeeRef = values.employee;
const label = values.label;
const expiresDays = values["expires-days"] ? Number(values["expires-days"]) : undefined;
if (expiresDays !== undefined && (!Number.isInteger(expiresDays) || expiresDays <= 0)) {
  console.error("--expires-days must be a positive whole number");
  process.exit(1);
}

await runWithDb(async (db) => {
  const employee = await findEmployee(db, employeeRef);
  if (!employee.active) throw new Error(`${employee.name} is deactivated`);

  const token = generateToken();
  const created = await db.apiToken.create({
    data: {
      employeeId: employee.id,
      label,
      hash: hashToken(token),
      last4: tokenLast4(token),
      expiresAt: expiresDays ? new Date(Date.now() + expiresDays * 86_400_000) : null,
    },
  });

  console.log(
    `Token ${created.id} for ${employee.name} (${employee.role.name}). It is shown once:\n\n  ${token}\n`,
  );
});
