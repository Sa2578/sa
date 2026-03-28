import type { EmailStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type DeliverabilityEventType =
  | "accepted"
  | "delivered"
  | "open"
  | "click"
  | "bounce"
  | "spam"
  | "reply"
  | "failed";

interface EmailEventIdentifiers {
  logId?: string | null;
  messageId?: string | null;
  providerMessageId?: string | null;
}

interface RecordEmailEventInput extends EmailEventIdentifiers {
  eventType: DeliverabilityEventType;
  source: "smtp" | "tracking" | "webhook" | "manual";
  occurredAt?: Date;
  payload?: Prisma.InputJsonValue;
  failureReason?: string | null;
  bounceType?: string | null;
  smtpResponse?: string | null;
}

function normalizeMessageId(value?: string | null) {
  return value?.trim() || null;
}

function normalizeLatestStatus(currentStatus: EmailStatus, nextStatus: EmailStatus): EmailStatus {
  if (currentStatus === "CLICKED" && nextStatus === "OPENED") return "CLICKED";
  if ((currentStatus === "OPENED" || currentStatus === "CLICKED") && nextStatus === "DELIVERED") return currentStatus;
  return nextStatus;
}

export function guessBounceType(message?: string | null) {
  if (!message) return null;
  if (/\b5\d{2}\b/.test(message) || /permanent|hard bounce/i.test(message)) return "hard";
  if (/\b4\d{2}\b/.test(message) || /temporary|soft bounce|defer/i.test(message)) return "soft";
  return null;
}

async function findEmailLog(identifiers: EmailEventIdentifiers) {
  if (identifiers.logId) {
    return prisma.emailLog.findUnique({
      where: { id: identifiers.logId },
      include: { lead: true },
    });
  }

  if (identifiers.providerMessageId) {
    return prisma.emailLog.findFirst({
      where: { providerMessageId: normalizeMessageId(identifiers.providerMessageId) ?? undefined },
      include: { lead: true },
      orderBy: { createdAt: "desc" },
    });
  }

  if (identifiers.messageId) {
    return prisma.emailLog.findFirst({
      where: { messageId: normalizeMessageId(identifiers.messageId) ?? undefined },
      include: { lead: true },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
}

export async function recordEmailEvent(input: RecordEmailEventInput) {
  const emailLog = await findEmailLog(input);
  if (!emailLog) {
    throw new Error("Email log not found");
  }

  const occurredAt = input.occurredAt ?? new Date();
  const messageId = normalizeMessageId(input.messageId) ?? emailLog.messageId;
  const providerMessageId = normalizeMessageId(input.providerMessageId) ?? emailLog.providerMessageId;

  const emailLogData: Prisma.EmailLogUpdateInput = {
    messageId,
    providerMessageId,
    latestEventType: input.eventType,
    lastEventAt: occurredAt,
  };

  let shouldUpdateLeadToBounced = false;
  let shouldUpdateLeadToReplied = false;

  switch (input.eventType) {
    case "accepted":
      emailLogData.status = normalizeLatestStatus(emailLog.status, "SENT");
      emailLogData.sentAt = emailLog.sentAt ?? occurredAt;
      emailLogData.smtpResponse = input.smtpResponse ?? emailLog.smtpResponse;
      break;
    case "delivered":
      emailLogData.status = normalizeLatestStatus(emailLog.status, "DELIVERED");
      emailLogData.deliveredAt = occurredAt;
      break;
    case "open":
      emailLogData.status = normalizeLatestStatus(emailLog.status, "OPENED");
      emailLogData.openedAt = emailLog.openedAt ?? occurredAt;
      break;
    case "click":
      emailLogData.status = "CLICKED";
      emailLogData.clickedAt = emailLog.clickedAt ?? occurredAt;
      emailLogData.openedAt = emailLog.openedAt ?? occurredAt;
      break;
    case "bounce":
      emailLogData.status = "BOUNCED";
      emailLogData.bouncedAt = occurredAt;
      emailLogData.failureReason = input.failureReason ?? emailLog.failureReason;
      emailLogData.bounceType = input.bounceType ?? guessBounceType(input.failureReason) ?? emailLog.bounceType;
      emailLogData.smtpResponse = input.smtpResponse ?? emailLog.smtpResponse;
      shouldUpdateLeadToBounced = true;
      break;
    case "spam":
      emailLogData.status = "SPAM";
      emailLogData.spamAt = occurredAt;
      break;
    case "reply":
      emailLogData.repliedAt = occurredAt;
      shouldUpdateLeadToReplied = true;
      break;
    case "failed":
      emailLogData.status = "FAILED";
      emailLogData.failureReason = input.failureReason ?? emailLog.failureReason;
      emailLogData.smtpResponse = input.smtpResponse ?? emailLog.smtpResponse;
      break;
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.emailLog.update({
      where: { id: emailLog.id },
      data: emailLogData,
    }),
    prisma.emailEvent.create({
      data: {
        emailLogId: emailLog.id,
        eventType: input.eventType,
        source: input.source,
        occurredAt,
        messageId,
        providerMessageId,
        payload: input.payload,
      },
    }),
  ];

  if (shouldUpdateLeadToBounced) {
    operations.push(
      prisma.lead.update({
        where: { id: emailLog.leadId },
        data: { status: "BOUNCED" },
      })
    );
  }

  if (shouldUpdateLeadToReplied) {
    operations.push(
      prisma.lead.update({
        where: { id: emailLog.leadId },
        data: { status: "REPLIED" },
      })
    );
  }

  await prisma.$transaction(operations);

  return prisma.emailLog.findUnique({
    where: { id: emailLog.id },
    include: {
      lead: { select: { email: true, name: true, status: true } },
      inbox: { select: { emailAddress: true } },
      events: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
}
