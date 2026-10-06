import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import {
  createTestActor,
  createTestContext,
  publishSampleTemplate,
  resetDatabase,
  testDatabaseUrl,
} from "../testing.js";
import {
  closeCase,
  createCase,
  getCase,
  listCases,
  moveCaseStage,
  updateCaseItem,
} from "./cases.js";
import { createClient } from "./clients.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("cases service", () => {
  let db: Db;
  let owner: Context;
  let validator: Context;
  let runner: Context;
  let assistant: Context;
  let clientId: string;

  const as = async (role: string) => createTestContext(db, (await createTestActor(db, role)).actor);

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    owner = await as("Owner");
    validator = await as("Validator");
    runner = await as("Runner");
    assistant = await as("Assistant (MCP)");
    await publishSampleTemplate(owner);
    clientId = (await createClient(owner, { fullName: "Hans Becker", nationality: "DE" })).id;
  });

  const open = () =>
    createCase(owner, { clientId, template: "retirement-extension", dueDate: "2026-10-21" });

  it("opens a case numbered from EZ-1000 with the template checklist copied", async () => {
    const created = await open();
    expect(created.number).toBe("EZ-1000");
    expect(created.stage).toBe("NEW");
    expect(created.items.map((i) => [i.label, i.status, i.required])).toEqual([
      ["Passport with all stamped pages", "MISSING", true],
      ["Bank letter confirming the balance", "MISSING", true],
      ["Two photos, 4 × 6 cm", "MISSING", true],
      ["Map to the residence", "MISSING", false],
    ]);
    expect(created.knownFailures).toEqual(["Photo background not white"]);
    expect((await getCase(owner, { case: "1000" })).id).toBe(created.id);
  });

  it("lets the assistant flag with a reason but never verify or waive", async () => {
    const c = await open();
    const [passport, bank] = c.items;
    await expect(
      updateCaseItem(assistant, { case: c.number, itemId: bank?.id ?? "", status: "FLAGGED" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const flagged = await updateCaseItem(assistant, {
      case: c.number,
      itemId: bank?.id ?? "",
      status: "FLAGGED",
      note: "Bank letter is dated 12 Sep, older than 7 days",
    });
    expect(flagged.items[1]).toMatchObject({ status: "FLAGGED", flaggedBy: "ASSISTANT" });

    for (const status of ["VERIFIED", "WAIVED"] as const) {
      await expect(
        updateCaseItem(assistant, {
          case: c.number,
          itemId: passport?.id ?? "",
          status,
          note: "x",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("guards VALIDATION and SUBMISSION, and only a person with approval rights submits", async () => {
    const c = await open();
    await expect(
      moveCaseStage(owner, { case: c.number, stage: "VALIDATION" }),
    ).rejects.toMatchObject({
      code: "GUARD_FAILED",
    });

    for (const item of c.items.filter((i) => i.required)) {
      await updateCaseItem(assistant, { case: c.number, itemId: item.id, status: "RECEIVED" });
    }
    const inValidation = await moveCaseStage(assistant, { case: c.number, stage: "VALIDATION" });
    expect(inValidation.stage).toBe("VALIDATION");

    await expect(
      moveCaseStage(validator, { case: c.number, stage: "SUBMISSION" }),
    ).rejects.toMatchObject({
      code: "GUARD_FAILED",
    });
    for (const item of c.items.filter((i) => i.required)) {
      await updateCaseItem(validator, { case: c.number, itemId: item.id, status: "VERIFIED" });
    }
    await expect(
      moveCaseStage(assistant, { case: c.number, stage: "SUBMISSION" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const submitted = await moveCaseStage(validator, { case: c.number, stage: "SUBMISSION" });
    expect(submitted.stage).toBe("SUBMISSION");
    expect(submitted.progress).toEqual({ requiredItems: 3, received: 3, verified: 3, flagged: 0 });
  });

  it("lets a runner record outcomes but not edit cases", async () => {
    const c = await open();
    for (const item of c.items.filter((i) => i.required)) {
      await updateCaseItem(validator, { case: c.number, itemId: item.id, status: "VERIFIED" });
    }
    await moveCaseStage(validator, { case: c.number, stage: "SUBMISSION" });

    await expect(
      moveCaseStage(runner, { case: c.number, stage: "DRAFTING" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const back = await closeCase(runner, {
      case: c.number,
      outcome: "MORE_DOCUMENTS",
      note: "Officer wants a second copy of the statement",
    });
    expect(back).toMatchObject({ stage: "COLLECTING", outcome: null, closedAt: null });

    await moveCaseStage(validator, { case: c.number, stage: "SUBMISSION" });
    const done = await closeCase(runner, { case: c.number, outcome: "APPROVED" });
    expect(done).toMatchObject({ stage: "DONE", outcome: "APPROVED" });
    expect(done.closedAt).not.toBeNull();

    await expect(
      updateCaseItem(validator, {
        case: c.number,
        itemId: c.items[0]?.id ?? "",
        status: "RECEIVED",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("withdraws a case at any stage with a note, and hides closed cases by default", async () => {
    const c = await open();
    await expect(closeCase(owner, { case: c.number, outcome: "WITHDRAWN" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await closeCase(owner, { case: c.number, outcome: "WITHDRAWN", note: "Client left Thailand" });
    expect((await listCases(owner, {})).items).toHaveLength(0);
    expect((await listCases(owner, { includeClosed: true })).items[0]?.stage).toBe("CANCELLED");
  });

  it("refuses outcomes before submission", async () => {
    const c = await open();
    await expect(closeCase(runner, { case: c.number, outcome: "APPROVED" })).rejects.toMatchObject({
      code: "GUARD_FAILED",
    });
  });
});
