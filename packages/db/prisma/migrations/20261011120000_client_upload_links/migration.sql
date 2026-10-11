-- AlterEnum
ALTER TYPE "Via" ADD VALUE 'CLIENT';

-- AlterTable
ALTER TABLE "CaseItem" ADD COLUMN     "clientUpload" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TemplateItem" ADD COLUMN     "clientUpload" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CaseShareLink" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "uploads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseShareLink_hash_key" ON "CaseShareLink"("hash");

-- CreateIndex
CREATE INDEX "CaseShareLink_caseId_idx" ON "CaseShareLink"("caseId");

-- AddForeignKey
ALTER TABLE "CaseShareLink" ADD CONSTRAINT "CaseShareLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Documents the client provides are what a shared checklist asks for: start with those.
UPDATE "TemplateItem" SET "clientUpload" = true WHERE "kind" = 'DOCUMENT';
UPDATE "CaseItem" SET "clientUpload" = true WHERE "kind" = 'DOCUMENT';
