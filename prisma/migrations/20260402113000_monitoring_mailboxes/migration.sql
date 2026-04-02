CREATE TYPE "MonitoringMailboxUsage" AS ENUM ('PLACEMENT', 'FEEDBACK_LOOP', 'BOTH');

CREATE TABLE "MonitoringMailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "usage" "MonitoringMailboxUsage" NOT NULL DEFAULT 'PLACEMENT',
    "imapHost" TEXT,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT NOT NULL,
    "imapPass" TEXT NOT NULL,
    "inboxFolderHint" TEXT,
    "spamFolderHint" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringMailbox_userId_emailAddress_key" ON "MonitoringMailbox"("userId", "emailAddress");
CREATE INDEX "MonitoringMailbox_userId_isActive_idx" ON "MonitoringMailbox"("userId", "isActive");

ALTER TABLE "MonitoringMailbox" ADD CONSTRAINT "MonitoringMailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
