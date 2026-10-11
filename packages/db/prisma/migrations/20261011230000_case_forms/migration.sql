-- CreateEnum
CREATE TYPE "CaseFormStatus" AS ENUM ('DRAFT', 'CHECKED');

-- AlterTable
ALTER TABLE "TemplateFile" ADD COLUMN     "fillableKey" TEXT;

-- CreateTable
CREATE TABLE "CaseForm" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "templateFileId" UUID NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "status" "CaseFormStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfKey" TEXT,
    "preparedAt" TIMESTAMP(3),
    "checkedById" UUID,
    "checkedAt" TIMESTAMP(3),
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseForm_caseId_templateFileId_key" ON "CaseForm"("caseId", "templateFileId");

-- AddForeignKey
ALTER TABLE "CaseForm" ADD CONSTRAINT "CaseForm_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseForm" ADD CONSTRAINT "CaseForm_templateFileId_fkey" FOREIGN KEY ("templateFileId") REFERENCES "TemplateFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
