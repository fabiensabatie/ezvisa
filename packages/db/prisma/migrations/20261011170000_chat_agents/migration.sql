-- CreateEnum
CREATE TYPE "AgentAudience" AS ENUM ('CLIENTS', 'TEAM');

-- AlterTable
ALTER TABLE "ChatContact" ADD COLUMN     "employeeId" UUID;

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "AgentAudience" NOT NULL DEFAULT 'CLIENTS',
    "instructions" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "employeeId" UUID NOT NULL,
    "chatwootBotId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_employeeId_key" ON "Agent"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_chatwootBotId_key" ON "Agent"("chatwootBotId");

-- AddForeignKey
ALTER TABLE "ChatContact" ADD CONSTRAINT "ChatContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
