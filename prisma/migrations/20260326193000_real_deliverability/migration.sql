-- AlterTable
ALTER TABLE "Domain"
ADD COLUMN     "dkimSelectors" JSONB,
ADD COLUMN     "spfRecord" TEXT,
ADD COLUMN     "dmarcRecord" TEXT,
ADD COLUMN     "mxRecords" JSONB,
ADD COLUMN     "dnsCheckReport" JSONB,
ADD COLUMN     "dnsLastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "dnsLastError" TEXT;

-- AlterTable
ALTER TABLE "Inbox"
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "replyToEmail" TEXT,
ADD COLUMN     "lastSmtpVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "smtpLastError" TEXT;

-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmailLog"
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "smtpResponse" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "bounceType" TEXT,
ADD COLUMN     "latestEventType" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "spamAt" TIMESTAMP(3),
ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "lastEventAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "emailLogId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,
    "providerMessageId" TEXT,
    "payload" JSONB,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLog_messageId_idx" ON "EmailLog"("messageId");

-- CreateIndex
CREATE INDEX "EmailLog_providerMessageId_idx" ON "EmailLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailLog_latestEventType_idx" ON "EmailLog"("latestEventType");

-- CreateIndex
CREATE INDEX "EmailEvent_emailLogId_receivedAt_idx" ON "EmailEvent"("emailLogId", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailEvent_eventType_idx" ON "EmailEvent"("eventType");

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_emailLogId_fkey" FOREIGN KEY ("emailLogId") REFERENCES "EmailLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
