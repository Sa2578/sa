import { Prisma, PrismaClient } from "@prisma/client";
import { getStartOfCurrentDay } from "./runtime";
import {
  decryptInboxCredentials,
  getInboxCredentialUpgrade,
} from "./smtp-credentials";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface SelectedInbox {
  id: string;
  emailAddress: string;
  senderName: string | null;
  replyToEmail: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  dailyLimit: number;
  sentToday: number;
}

function getAvailableInboxQuery(userId: string, startOfDay: Date) {
  return Prisma.sql`
    SELECT
      i.id,
      i."emailAddress",
      i."senderName",
      i."replyToEmail",
      i."smtpHost",
      i."smtpPort",
      i."smtpUser",
      i."smtpPass",
      i."dailyLimit",
      COUNT(el.id)::int AS "sentToday"
    FROM "Inbox" i
    JOIN "Domain" d ON i."domainId" = d.id
    LEFT JOIN "EmailLog" el
      ON el."inboxId" = i.id
      AND el."createdAt" >= ${startOfDay}
    WHERE i."isActive" = true
      AND d."userId" = ${userId}
      AND d.status = 'ACTIVE'
    GROUP BY
      i.id,
      i."emailAddress",
      i."senderName",
      i."replyToEmail",
      i."smtpHost",
      i."smtpPort",
      i."smtpUser",
      i."smtpPass",
      i."dailyLimit",
      i."updatedAt"
    HAVING COUNT(el.id) < i."dailyLimit"
    ORDER BY COUNT(el.id) ASC, i."updatedAt" ASC
    FOR UPDATE OF i SKIP LOCKED
    LIMIT 1
  `;
}

export async function selectInboxForSending(
  tx: DbClient,
  userId: string
): Promise<SelectedInbox | null> {
  const startOfDay = getStartOfCurrentDay();
  const inboxes = await tx.$queryRaw<SelectedInbox[]>(
    getAvailableInboxQuery(userId, startOfDay)
  );

  const inbox = inboxes[0];
  if (!inbox) {
    return null;
  }

  const credentialUpgrade = getInboxCredentialUpgrade(inbox);
  if (Object.keys(credentialUpgrade).length > 0) {
    await tx.inbox.update({
      where: { id: inbox.id },
      data: credentialUpgrade,
    });
  }

  return decryptInboxCredentials(inbox);
}

export async function syncInboxDailyCounters(tx: DbClient, inboxIds?: string[]) {
  const startOfDay = getStartOfCurrentDay();
  const whereClause =
    inboxIds && inboxIds.length > 0
      ? Prisma.sql`WHERE i.id IN (${Prisma.join(inboxIds)})`
      : Prisma.empty;

  const counts = await tx.$queryRaw<Array<{ id: string; sentToday: number }>>(Prisma.sql`
    SELECT
      i.id,
      COUNT(el.id)::int AS "sentToday"
    FROM "Inbox" i
    LEFT JOIN "EmailLog" el
      ON el."inboxId" = i.id
      AND el."createdAt" >= ${startOfDay}
    ${whereClause}
    GROUP BY i.id
  `);

  await Promise.all(
    counts.map(({ id, sentToday }) =>
      tx.inbox.update({
        where: { id },
        data: { sentToday },
      })
    )
  );
}
