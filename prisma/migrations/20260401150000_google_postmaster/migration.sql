-- CreateTable
CREATE TABLE "GooglePostmasterAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "tokenType" TEXT,
    "scope" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePostmasterAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GooglePostmasterDomain" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePostmasterDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GooglePostmasterTrafficStat" (
    "id" TEXT NOT NULL,
    "postmasterDomainId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "statDate" TIMESTAMP(3) NOT NULL,
    "domainReputation" TEXT,
    "userReportedSpamRatio" DOUBLE PRECISION,
    "userReportedSpamRatioLowerBound" DOUBLE PRECISION,
    "userReportedSpamRatioUpperBound" DOUBLE PRECISION,
    "spfSuccessRatio" DOUBLE PRECISION,
    "dkimSuccessRatio" DOUBLE PRECISION,
    "dmarcSuccessRatio" DOUBLE PRECISION,
    "outboundEncryptionRatio" DOUBLE PRECISION,
    "inboundEncryptionRatio" DOUBLE PRECISION,
    "deliveryErrors" JSONB,
    "ipReputations" JSONB,
    "spammyFeedbackLoops" JSONB,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePostmasterTrafficStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GooglePostmasterAccount_userId_key" ON "GooglePostmasterAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GooglePostmasterDomain_resourceName_key" ON "GooglePostmasterDomain"("resourceName");

-- CreateIndex
CREATE UNIQUE INDEX "GooglePostmasterDomain_accountId_domainName_key" ON "GooglePostmasterDomain"("accountId", "domainName");

-- CreateIndex
CREATE INDEX "GooglePostmasterDomain_accountId_idx" ON "GooglePostmasterDomain"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "GooglePostmasterTrafficStat_postmasterDomainId_statDate_key" ON "GooglePostmasterTrafficStat"("postmasterDomainId", "statDate");

-- CreateIndex
CREATE INDEX "GooglePostmasterTrafficStat_statDate_idx" ON "GooglePostmasterTrafficStat"("statDate");

-- CreateIndex
CREATE INDEX "GooglePostmasterTrafficStat_postmasterDomainId_idx" ON "GooglePostmasterTrafficStat"("postmasterDomainId");

-- AddForeignKey
ALTER TABLE "GooglePostmasterAccount" ADD CONSTRAINT "GooglePostmasterAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GooglePostmasterDomain" ADD CONSTRAINT "GooglePostmasterDomain_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GooglePostmasterAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GooglePostmasterTrafficStat" ADD CONSTRAINT "GooglePostmasterTrafficStat_postmasterDomainId_fkey" FOREIGN KEY ("postmasterDomainId") REFERENCES "GooglePostmasterDomain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
