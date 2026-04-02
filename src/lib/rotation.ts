import { prisma } from "./prisma";
import {
  decryptInboxCredentials,
  getInboxCredentialUpgrade,
} from "./smtp-credentials";

export async function getNextInbox(userId: string) {
  const inbox = await prisma.inbox.findFirst({
    where: {
      isActive: true,
      domain: {
        userId,
        status: "ACTIVE",
      },
      sentToday: {
        lt: prisma.inbox.fields.dailyLimit ? undefined : 999999,
      },
    },
    orderBy: { sentToday: "asc" },
    include: { domain: true },
  });

  if (!inbox) return null;

  // Double check limit
  if (inbox.sentToday >= inbox.dailyLimit) return null;

  const credentialUpgrade = getInboxCredentialUpgrade(inbox);
  if (Object.keys(credentialUpgrade).length > 0) {
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: credentialUpgrade,
    });
  }

  return decryptInboxCredentials(inbox);
}

export async function getNextInboxRaw(userId: string) {
  // Use raw query for proper lt comparison against own column
  const inboxes = await prisma.$queryRaw<
    Array<{ id: string; emailAddress: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; dailyLimit: number; sentToday: number; domainId: string }>
  >`
    SELECT i.* FROM "Inbox" i
    JOIN "Domain" d ON i."domainId" = d.id
    WHERE i."isActive" = true
      AND d."userId" = ${userId}
      AND d.status = 'ACTIVE'
      AND i."sentToday" < i."dailyLimit"
    ORDER BY i."sentToday" ASC
    LIMIT 1
  `;

  const inbox = inboxes[0];
  if (!inbox) return null;

  const credentialUpgrade = getInboxCredentialUpgrade(inbox);
  if (Object.keys(credentialUpgrade).length > 0) {
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: credentialUpgrade,
    });
  }

  return decryptInboxCredentials(inbox);
}

export async function incrementSentCount(inboxId: string) {
  await prisma.inbox.update({
    where: { id: inboxId },
    data: { sentToday: { increment: 1 } },
  });
}

export async function resetDailyCounts() {
  await prisma.inbox.updateMany({
    data: { sentToday: 0 },
  });
}
