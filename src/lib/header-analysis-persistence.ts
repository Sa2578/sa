import type { EmailStatus, Prisma } from "@prisma/client";
import { analyzeRawHeaders } from "./header-analysis";
import { prisma } from "./prisma";

export const headerPlacementValues = [
  "INBOX",
  "PROMOTIONS",
  "SPAM",
  "UPDATES",
  "FORUMS",
  "OTHER",
  "UNKNOWN",
] as const;

export type HeaderPlacement = (typeof headerPlacementValues)[number];

interface PersistHeaderAnalysisOptions {
  rawHeaders?: string;
  emailLogId?: string;
  placement?: HeaderPlacement;
  userId?: string;
  mailboxProvider?: string;
  source?: "manual" | "imap";
  payloadMetadata?: Prisma.InputJsonObject;
}

function shouldPromoteToDelivered(status: EmailStatus) {
  return status === "QUEUED" || status === "SENT" || status === "FAILED";
}

export async function persistHeaderAnalysis(options: PersistHeaderAnalysisOptions) {
  const rawHeaders = options.rawHeaders?.trim();
  const analysis = rawHeaders ? analyzeRawHeaders(rawHeaders) : null;
  const observationKind = analysis
    ? "mailbox_header_analysis"
    : "mailbox_placement_observation";

  if (!analysis && !options.emailLogId) {
    throw new Error("Email log ID is required when raw headers are not provided");
  }

  const ownershipClause = options.userId
    ? { inbox: { domain: { userId: options.userId } } }
    : {};

  let emailLog = null;

  if (options.emailLogId) {
    emailLog = await prisma.emailLog.findFirst({
      where: {
        id: options.emailLogId,
        ...ownershipClause,
      },
      select: {
        id: true,
        status: true,
        latestEventType: true,
        lastEventAt: true,
        deliveredAt: true,
        spamAt: true,
        messageId: true,
        providerMessageId: true,
        inbox: {
          select: {
            emailAddress: true,
          },
        },
      },
    });
  }

  if (!emailLog && analysis?.messageId) {
    emailLog = await prisma.emailLog.findFirst({
      where: {
        ...ownershipClause,
        OR: [
          { messageId: analysis.messageId },
          { providerMessageId: analysis.messageId },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        latestEventType: true,
        lastEventAt: true,
        deliveredAt: true,
        spamAt: true,
        messageId: true,
        providerMessageId: true,
        inbox: {
          select: {
            emailAddress: true,
          },
        },
      },
    });
  }

  if (!emailLog) {
    return {
      analysis,
      persisted: false,
      matchedLog: false,
      observationKind,
    };
  }

  const occurredAt = new Date();
  const placement = options.placement ?? "UNKNOWN";
  const payload = {
    kind: observationKind,
    placement,
    mailboxProvider: options.mailboxProvider?.trim() || null,
    analysis: analysis as unknown as Prisma.InputJsonValue,
    ...(options.payloadMetadata || {}),
  } as Prisma.InputJsonObject;

  const emailLogData: Prisma.EmailLogUpdateInput = {
    messageId: analysis?.messageId ?? emailLog.messageId,
    providerMessageId: analysis?.messageId ?? emailLog.providerMessageId,
  };

  if (placement === "SPAM") {
    emailLogData.status = "SPAM";
    emailLogData.spamAt = emailLog.spamAt ?? occurredAt;
    emailLogData.latestEventType = "spam";
    emailLogData.lastEventAt = occurredAt;
  } else if (analysis || placement !== "UNKNOWN") {
    emailLogData.deliveredAt = emailLog.deliveredAt ?? occurredAt;

    if (shouldPromoteToDelivered(emailLog.status)) {
      emailLogData.status = "DELIVERED";
      emailLogData.latestEventType = "delivered";
      emailLogData.lastEventAt = occurredAt;
    }
  }

  await prisma.$transaction([
    prisma.emailLog.update({
      where: { id: emailLog.id },
      data: emailLogData,
    }),
    prisma.emailEvent.create({
      data: {
        emailLogId: emailLog.id,
        eventType: "header_analysis",
        source: options.source ?? "manual",
        occurredAt,
        messageId: analysis?.messageId ?? emailLog.messageId,
        providerMessageId: analysis?.messageId ?? emailLog.providerMessageId,
        payload,
      },
    }),
  ]);

  return {
    analysis,
    persisted: true,
    matchedLog: true,
    placement,
    observationKind,
    emailLogId: emailLog.id,
    inboxEmailAddress: emailLog.inbox.emailAddress,
  };
}
