-- AlterTable
ALTER TABLE "TemplateItem" ADD COLUMN "originId" UUID;

-- AlterTable
ALTER TABLE "TemplateFile" ADD COLUMN "originId" UUID;

-- Backfill: each item copies the item with the same label in the template's latest earlier version.
UPDATE "TemplateItem" AS item
SET "originId" = (
  SELECT prev_item.id
  FROM "TemplateVersion" AS v
  JOIN "TemplateVersion" AS prev ON prev."templateId" = v."templateId" AND prev.version < v.version
  JOIN "TemplateItem" AS prev_item ON prev_item."versionId" = prev.id
  WHERE v.id = item."versionId"
    AND lower(trim(prev_item.label)) = lower(trim(item.label))
  ORDER BY prev.version DESC, prev_item.position ASC
  LIMIT 1
);

-- Backfill: each file copies the file with the same object, else the same name, in the latest earlier version.
UPDATE "TemplateFile" AS file
SET "originId" = (
  SELECT prev_file.id
  FROM "TemplateVersion" AS v
  JOIN "TemplateVersion" AS prev ON prev."templateId" = v."templateId" AND prev.version < v.version
  JOIN "TemplateFile" AS prev_file ON prev_file."versionId" = prev.id
  WHERE v.id = file."versionId"
    AND (prev_file."storageKey" = file."storageKey" OR prev_file.name = file.name)
  ORDER BY prev.version DESC, (prev_file."storageKey" = file."storageKey") DESC
  LIMIT 1
);
