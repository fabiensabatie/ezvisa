-- CreateEnum
CREATE TYPE "LinkCategory" AS ENUM ('IMMIGRATION', 'WORK_PERMITS', 'DOCUMENTS', 'INSURANCE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "LinkAudience" AS ENUM ('TEAM', 'CLIENT', 'BOTH');

-- CreateTable
CREATE TABLE "UsefulLink" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" "LinkCategory" NOT NULL,
    "note" TEXT,
    "audience" "LinkAudience" NOT NULL DEFAULT 'TEAM',
    "needsLogin" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsefulLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsefulLink_category_name_idx" ON "UsefulLink"("category", "name");


-- Every role gets a level on useful links. The preset roles match ROLE_PRESETS in
-- @ezvisa/core; roles owners created can read the links, and an owner can raise that.
UPDATE "Role"
SET
  "permissions" = jsonb_set(
    "permissions",
    '{links}',
    to_jsonb(CASE
      WHEN "isSystem" AND "name" IN ('Owner', 'Senior agent') THEN 'full'
      WHEN "isSystem" AND "name" IN ('Validator', 'Runner') THEN 'edit'
      WHEN "isSystem" AND "name" = 'Client agent' THEN 'none'
      ELSE 'view'
    END)
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ("permissions" ? 'links');

-- Starter links, so the page is not empty. None is marked checked: someone on the team
-- confirms each one works.
INSERT INTO "UsefulLink" ("id", "name", "url", "category", "note", "audience", "needsLogin", "pinned", "updatedAt")
VALUES
  (gen_random_uuid(), 'Thai e-Visa', 'https://www.thaievisa.go.th', 'IMMIGRATION', 'Official e-Visa portal for applying from abroad. Clients apply here before they fly; we check their uploads first.', 'BOTH', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Chiang Mai Immigration Office', 'https://chiangmaiimm.com', 'IMMIGRATION', 'Office hours, queue notices and the local document checklist.', 'TEAM', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '90-day report online (TM47)', 'https://tm47.immigration.go.th', 'IMMIGRATION', 'File 90-day reports up to 15 days before the due date and 7 days after. Save the receipt PDF to the client''s file.', 'BOTH', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TM30 address notification', 'https://tm30.immigration.go.th', 'IMMIGRATION', 'Landlords or hotels report where a foreigner stays. Ask for the receipt before a visa extension.', 'CLIENT', true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Thailand Digital Arrival Card', 'https://tdac.immigration.go.th', 'IMMIGRATION', 'TDAC replaces the paper TM6. Clients submit it within 3 days before arrival.', 'CLIENT', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Immigration Bureau', 'https://www.immigration.go.th', 'IMMIGRATION', 'Announcements, the fee schedule and the official forms (TM7, TM8, TM47).', 'TEAM', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'e-WorkPermit', 'https://workpermit.doe.go.th', 'WORK_PERMITS', 'Apply for and renew work permits online. New applications need the employer''s account.', 'TEAM', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Department of Employment', 'https://www.doe.go.th', 'WORK_PERMITS', 'Rules for foreign workers, restricted occupations and the work permit fees.', 'TEAM', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LTR visa (BOI)', 'https://ltr.boi.go.th', 'WORK_PERMITS', 'Long-Term Resident visa applications and eligibility checks.', 'BOTH', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Board of Investment', 'https://www.boi.go.th', 'WORK_PERMITS', 'BOI-promoted companies use its single window for visas and work permits.', 'TEAM', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Consular legalisation (MFA)', 'https://www.consular.mfa.go.th', 'DOCUMENTS', 'Book appointments to legalise Thai documents and translations.', 'TEAM', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Ministry of Foreign Affairs', 'https://www.mfa.go.th', 'DOCUMENTS', 'Thai embassy and consulate directory, for clients applying abroad.', 'TEAM', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Long-stay health insurance (TGIA)', 'https://longstay.tgia.org', 'INSURANCE_MONEY', 'Insurer list and certificate check for O-A and O-X applicants.', 'BOTH', false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Revenue Department', 'https://www.rd.go.th', 'INSURANCE_MONEY', 'Tax ID and personal income tax for clients on work permits.', 'TEAM', false, false, CURRENT_TIMESTAMP);
