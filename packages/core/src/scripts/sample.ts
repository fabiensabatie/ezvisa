import type { Db } from "@ezvisa/db";
import type { Context } from "../context.js";
import { addDays, bangkokToday } from "../dates.js";
import { parsePermissions } from "../permissions.js";
import { ASSISTANT_EMAIL } from "../seed-base.js";
import * as cases from "../services/cases.js";
import * as clients from "../services/clients.js";
import * as templates from "../services/templates.js";
import { runWithDb } from "./cli.js";

// Sample data for local testing: templates, a small team, clients and cases at every
// stage, with dates relative to today. Built through the real services, so every rule
// and audit entry applies. Refuses production and databases that already have clients.

if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
  console.error("Refusing to load sample data into production.");
  process.exit(1);
}

const doc = (label: string, extra: { required?: boolean; kind?: "FORM" | "PAYMENT" } = {}) => ({
  label,
  ...extra,
});

const TEMPLATES = [
  {
    slug: "retirement-extension",
    name: "Retirement extension",
    description: "Non-O, one-year extension of stay based on retirement",
    deadlineKind: "STAY_ENDS" as const,
    knownFailures: [
      "Bank letter older than the office accepts",
      "Photo background not white",
      "Name spelled differently on the lease and the passport",
    ],
    items: [
      doc("Passport with all stamped pages"),
      doc("Current visa or extension stamp"),
      doc("Arrival record (TM.6 or TDAC)"),
      doc("Bank book updated on the day"),
      doc("Bank letter confirming the balance"),
      doc("12-month bank statement"),
      doc("Two photos, 4 × 6 cm"),
      doc("TM.30 receipt"),
      doc("Lease or house book"),
      doc("Map to the residence", { required: false }),
      doc("TM.7 application", { kind: "FORM" }),
    ],
  },
  {
    slug: "dtv-extension",
    name: "DTV 180-day extension",
    description: "Destination Thailand Visa, extension in country",
    deadlineKind: "STAY_ENDS" as const,
    knownFailures: [
      "Funds statement not in the applicant's own name",
      "TM.30 missing after a move",
    ],
    items: [
      doc("Passport with the DTV visa page"),
      doc("Arrival record (TM.6 or TDAC)"),
      doc("Proof of funds, 500,000 THB"),
      doc("TM.30 receipt"),
      doc("Lease or hotel booking"),
      doc("One photo, 4 × 6 cm"),
      doc("TM.7 application", { kind: "FORM" }),
      doc("Fee receipt", { kind: "PAYMENT" }),
    ],
  },
  {
    slug: "ninety-day-report",
    name: "90-day report",
    description: "TM.47 notification of residence",
    deadlineKind: "REPORT_DUE" as const,
    knownFailures: ["Filed outside the reporting window"],
    items: [
      doc("Passport"),
      doc("TM.47 form", { kind: "FORM" }),
      doc("Previous 90-day receipt"),
      doc("TM.30 receipt"),
    ],
  },
  {
    slug: "tm30-notification",
    name: "TM.30 notification",
    description: "Residence notification after a move",
    knownFailures: ["House owner ID copy not signed"],
    items: [
      doc("Passport"),
      doc("Lease or house book"),
      doc("House owner ID copy"),
      doc("TM.30 form", { kind: "FORM" }),
    ],
  },
];

function contextFor(
  db: Db,
  employee: {
    id: string;
    name: string;
    kind: "HUMAN" | "ASSISTANT";
    role: { name: string; permissions: unknown };
  },
): Context {
  return {
    actor: {
      employeeId: employee.id,
      name: employee.name,
      roleName: employee.role.name,
      kind: employee.kind,
      permissions: parsePermissions(employee.role.permissions),
      tokenId: "sample-data",
    },
    via: "SYSTEM",
    db,
    storage: null,
    now: () => new Date(),
  };
}

await runWithDb(async (db) => {
  if ((await db.client.count()) > 0) {
    console.log("Sample data skipped: the database already has clients.");
    return;
  }
  const ownerRow = await db.employee.findFirst({
    where: { role: { name: "Owner" }, active: true },
    include: { role: true },
  });
  const assistantRow = await db.employee.findUnique({
    where: { email: ASSISTANT_EMAIL },
    include: { role: true },
  });
  if (!ownerRow || !assistantRow) throw new Error("Run pnpm db:seed first.");
  const owner = contextFor(db, ownerRow);
  const assistant = contextFor(db, assistantRow);

  const roles = new Map((await db.role.findMany()).map((r) => [r.name, r.id]));
  const teamMember = async (name: string, email: string, role: string) =>
    (await db.employee.findUnique({ where: { email } })) ??
    db.employee.create({ data: { name, email, roleId: roles.get(role) ?? "" } });
  const ploy = await teamMember("Ploy S.", "ploy@ezvisa.local", "Validator");
  const beam = await teamMember("Beam T.", "beam@ezvisa.local", "Runner");

  for (const template of TEMPLATES) {
    if (!(await db.template.findUnique({ where: { slug: template.slug } }))) {
      await templates.createTemplate(owner, template);
      await templates.publishTemplateVersion(owner, {
        template: template.slug,
        notes: "Sample version",
      });
    }
  }

  const day = (n: number) => addDays(bangkokToday(new Date()), n);
  const client = (input: Parameters<typeof clients.createClient>[1]) =>
    clients.createClient(owner, { consentGiven: true, ...input });

  const margaret = await client({
    fullName: "Margaret Ellis",
    nationality: "GB",
    dateOfBirth: "1955-03-12",
    visaType: "Non-O retirement",
    stayUntil: day(13),
    nextReportDue: day(62),
    channel: "LINE",
    email: "margaret@example.com",
  });
  const hans = await client({
    fullName: "Hans Becker",
    nationality: "DE",
    dateOfBirth: "1952-11-02",
    visaType: "Non-O retirement",
    stayUntil: day(33),
    nextReportDue: day(18),
    channel: "EMAIL",
    email: "hans@example.com",
  });
  const sophie = await client({
    fullName: "Sophie Laurent",
    nationality: "FR",
    dateOfBirth: "1991-06-30",
    visaType: "DTV",
    stayUntil: day(23),
    channel: "WHATSAPP",
    phone: "+33 6 12 34 56 78",
  });
  const david = await client({
    fullName: "David Cohen",
    nationality: "US",
    dateOfBirth: "1957-01-21",
    visaType: "Non-O retirement",
    stayUntil: day(161),
    nextReportDue: day(2),
    channel: "LINE",
  });
  const emma = await client({
    fullName: "Emma Walsh",
    nationality: "IE",
    dateOfBirth: "1960-08-14",
    visaType: "Non-O, 90-day entry",
    stayUntil: day(42),
    channel: "MESSENGER",
  });
  const lars = await client({
    fullName: "Lars Nilsson",
    nationality: "SE",
    dateOfBirth: "1988-02-03",
    visaType: "DTV",
    stayUntil: day(140),
    channel: "MESSENGER",
  });
  await client({
    fullName: "Chen Wei",
    nationality: "CN",
    dateOfBirth: "1998-09-09",
    visaType: "ED",
    stayUntil: day(26),
    channel: "WHATSAPP",
  });
  await client({
    fullName: "Giulia Romano",
    nationality: "IT",
    dateOfBirth: "1956-05-17",
    visaType: "Non-O retirement",
    stayUntil: day(48),
    nextReportDue: day(11),
    channel: "LINE",
  });
  await client({
    fullName: "Tom Richards",
    nationality: "AU",
    visaType: "DTV",
    stayUntil: day(5),
    channel: "WHATSAPP",
    consentGiven: false,
  });

  const open = (clientId: string, template: string, assigneeId: string, dueIn: number) =>
    cases.createCase(owner, { clientId, template, assigneeId, dueDate: day(dueIn) });
  const mark = async (
    ctx: Context,
    number: string,
    items: Array<{ id: string }>,
    status: "RECEIVED" | "VERIFIED" | "FLAGGED",
    note?: string,
  ) => {
    for (const item of items)
      await cases.updateCaseItem(ctx, { case: number, itemId: item.id, status, note });
  };
  const required = (c: { items: Array<{ id: string; required: boolean }> }) =>
    c.items.filter((i) => i.required);

  // Margaret: everything received, waiting for a validator.
  const c1 = await open(margaret.id, "retirement-extension", ploy.id, 8);
  await mark(owner, c1.number, required(c1), "RECEIVED");
  await cases.moveCaseStage(owner, { case: c1.number, stage: "VALIDATION" });

  // Hans: collecting, with two items flagged by the assistant.
  const c2 = await open(hans.id, "retirement-extension", ploy.id, 20);
  await cases.moveCaseStage(owner, { case: c2.number, stage: "COLLECTING" });
  await mark(assistant, c2.number, c2.items.slice(0, 4), "RECEIVED");
  await mark(
    assistant,
    c2.number,
    [c2.items[4] ?? { id: "" }],
    "FLAGGED",
    "Bank letter is dated 3 weeks ago; the office wants one from the last 7 days",
  );
  await mark(
    assistant,
    c2.number,
    [c2.items[6] ?? { id: "" }],
    "FLAGGED",
    "Photo background is grey, the office wants white",
  );

  // Sophie: collecting, TM.30 missing after a move.
  const c3 = await open(sophie.id, "dtv-extension", ploy.id, 14);
  await cases.moveCaseStage(owner, { case: c3.number, stage: "COLLECTING" });
  await mark(assistant, c3.number, c3.items.slice(0, 3), "RECEIVED");
  await mark(
    assistant,
    c3.number,
    [c3.items[3] ?? { id: "" }],
    "FLAGGED",
    "No TM.30 since her move last month",
  );

  // David: verified and ready for the runner.
  const c4 = await open(david.id, "ninety-day-report", beam.id, 2);
  await mark(owner, c4.number, required(c4), "VERIFIED");
  await cases.moveCaseStage(owner, { case: c4.number, stage: "SUBMISSION" });

  // Emma: new inquiry.
  await open(emma.id, "retirement-extension", ownerRow.id, 35);

  // Lars: TM.30 filed and approved.
  const c6 = await open(lars.id, "tm30-notification", beam.id, -3);
  await mark(owner, c6.number, required(c6), "VERIFIED");
  await cases.moveCaseStage(owner, { case: c6.number, stage: "SUBMISSION" });
  await cases.closeCase(owner, { case: c6.number, outcome: "APPROVED" });

  console.log(
    "Loaded sample data: 4 templates, Ploy (Validator) and Beam (Runner), 9 clients and 6 cases.",
  );
});
