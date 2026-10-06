import { createDb, type Db } from "@ezvisa/db";
import { loadRootEnv } from "../env.js";

/** Runs a script body with a connected client, then disconnects. Exits 1 on error. */
export async function runWithDb(body: (db: Db) => Promise<void>): Promise<void> {
  loadRootEnv();
  const db = createDb();
  try {
    await body(db);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

/** Finds an employee by email or by id. */
export async function findEmployee(db: Db, emailOrId: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(emailOrId);
  const employee = await db.employee.findFirst({
    where: isUuid ? { id: emailOrId } : { email: emailOrId.toLowerCase() },
    include: { role: true },
  });
  if (!employee) throw new Error(`No employee matches "${emailOrId}"`);
  return employee;
}
