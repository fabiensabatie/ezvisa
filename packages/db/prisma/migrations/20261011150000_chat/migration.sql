-- AlterEnum
ALTER TYPE "Via" ADD VALUE 'CHAT';

-- CreateTable
CREATE TABLE "ChatContact" (
    "id" UUID NOT NULL,
    "chatwootId" INTEGER NOT NULL,
    "clientId" UUID,
    "name" TEXT,
    "channel" TEXT,
    "linkedAt" TIMESTAMP(3),
    "linkedById" UUID,
    "failedChecks" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatContact_chatwootId_key" ON "ChatContact"("chatwootId");

-- CreateIndex
CREATE INDEX "ChatContact_clientId_idx" ON "ChatContact"("clientId");

-- AddForeignKey
ALTER TABLE "ChatContact" ADD CONSTRAINT "ChatContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
