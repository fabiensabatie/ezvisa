-- AlterTable
ALTER TABLE "CaseShareLink" ADD COLUMN     "viewFailedAt" TIMESTAMP(3),
ADD COLUMN     "viewFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "uploadedViaLinkId" UUID;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedViaLinkId_fkey" FOREIGN KEY ("uploadedViaLinkId") REFERENCES "CaseShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Files clients uploaded before this change: the audit log names the link each came through.
UPDATE "Document" AS d
SET "uploadedViaLinkId" = l."id"
FROM "AuditLog" AS a
JOIN "CaseShareLink" AS l ON l."id"::text = a."after"->>'linkId'
WHERE a."via" = 'CLIENT'
  AND a."action" = 'document.uploaded'
  AND a."entityId" = d."id"::text;
