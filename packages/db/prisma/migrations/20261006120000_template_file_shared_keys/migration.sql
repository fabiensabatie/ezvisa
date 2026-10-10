-- DropIndex
DROP INDEX "TemplateFile_storageKey_key";

-- CreateIndex
CREATE INDEX "TemplateFile_storageKey_idx" ON "TemplateFile"("storageKey");

-- Make 1000 the declared start, so RESTART IDENTITY (used by tests) keeps EZ- numbers at 1000+.
ALTER SEQUENCE "Case_number_seq" START WITH 1000;
