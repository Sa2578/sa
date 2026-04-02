import type { Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { prisma } from "./prisma";
import { recordEmailEvent } from "./email-events";
import { resolveImapConfig } from "./imap-config";
import {
  decryptInboxCredentials,
  getInboxCredentialUpgrade,
} from "./smtp-credentials";

interface SyncRepliesOptions {
  userId?: string;
  inboxId?: string;
  inboxEmailAddress?: string;
  lookbackDays?: number;
  maxMessages?: number;
}

interface SyncRepliesBatchOptions {
  userId?: string;
  inboxIds?: string[];
  lookbackDays?: number;
  maxMessages?: number;
  maxInboxes?: number;
}

export interface ReplySyncBatchInboxResult {
  inboxId: string;
  inboxEmailAddress: string;
  success: boolean;
  scannedMessages?: number;
  matchedReplies?: number;
  newReplies?: number;
  skippedAlreadySynced?: number;
  skippedSelfMessages?: number;
  error?: string;
}

function normalizeMessageReference(value?: string | null) {
  if (!value) return null;
  return value.replace(/[<>]/g, "").trim().toLowerCase() || null;
}

function extractMessageReferences(value?: string | null) {
  if (!value) return [];

  const matches = value.match(/<[^>]+>/g);
  if (matches?.length) {
    return matches
      .map((entry) => normalizeMessageReference(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const normalized = normalizeMessageReference(value);
  return normalized ? [normalized] : [];
}

function unfoldHeaders(rawHeaders: string) {
  return rawHeaders.replace(/\r?\n[ \t]+/g, " ");
}

function collectHeaderValues(rawHeaders: string, name: string) {
  const normalizedName = name.toLowerCase();
  return unfoldHeaders(rawHeaders)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) return [];
      const headerName = line.slice(0, separatorIndex).trim().toLowerCase();
      if (headerName !== normalizedName) return [];
      return [line.slice(separatorIndex + 1).trim()];
    });
}

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function syncInboxReplies(options: SyncRepliesOptions) {
  const { lookbackDays = 14, maxMessages = 200 } = options;
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const inbox = await prisma.inbox.findFirst({
    where: {
      ...(options.inboxId ? { id: options.inboxId } : {}),
      ...(options.inboxEmailAddress ? { emailAddress: options.inboxEmailAddress } : {}),
      ...(options.userId ? { domain: { userId: options.userId } } : {}),
    },
    select: {
      id: true,
      emailAddress: true,
      replyToEmail: true,
      smtpHost: true,
      smtpUser: true,
      smtpPass: true,
      domain: {
        select: {
          domainName: true,
          userId: true,
        },
      },
    },
  });

  if (!inbox) {
    throw new Error("Inbox not found");
  }

  const credentialUpgrade = getInboxCredentialUpgrade(inbox);
  if (Object.keys(credentialUpgrade).length > 0) {
    await prisma.inbox.update({
      where: { id: inbox.id },
      data: credentialUpgrade,
    });
  }

  const decryptedInbox = decryptInboxCredentials(inbox);

  const candidateLogs = await prisma.emailLog.findMany({
    where: {
      inboxId: decryptedInbox.id,
      sentAt: { gte: since },
      OR: [{ messageId: { not: null } }, { providerMessageId: { not: null } }],
    },
    select: {
      id: true,
      messageId: true,
      providerMessageId: true,
      repliedAt: true,
      sentAt: true,
    },
    orderBy: { sentAt: "desc" },
  });

  const logByReference = new Map<
    string,
    { id: string; repliedAt: Date | null; sentAt: Date | null }
  >();
  for (const log of candidateLogs) {
    for (const reference of [log.messageId, log.providerMessageId]) {
      const normalized = normalizeMessageReference(reference);
      if (normalized && !logByReference.has(normalized)) {
        logByReference.set(normalized, {
          id: log.id,
          repliedAt: log.repliedAt,
          sentAt: log.sentAt,
        });
      }
    }
  }

  const existingReplyEvents = await prisma.emailEvent.findMany({
    where: {
      eventType: "reply",
      emailLog: { inboxId: decryptedInbox.id },
      receivedAt: { gte: since },
    },
    select: {
      messageId: true,
      providerMessageId: true,
    },
  });

  const knownReplyMessageIds = new Set<string>();
  for (const event of existingReplyEvents) {
    for (const value of [event.messageId, event.providerMessageId]) {
      const normalized = normalizeMessageReference(value);
      if (normalized) {
        knownReplyMessageIds.add(normalized);
      }
    }
  }

  const selfAddresses = new Set(
    [decryptedInbox.emailAddress, decryptedInbox.replyToEmail, decryptedInbox.smtpUser]
      .filter(Boolean)
      .map((entry) => entry!.trim().toLowerCase())
  );

  const imap = resolveImapConfig(decryptedInbox);
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: {
      user: decryptedInbox.smtpUser,
      pass: decryptedInbox.smtpPass,
    },
    logger: false,
    disableAutoIdle: true,
  });

  let scannedMessages = 0;
  let matchedReplies = 0;
  let newReplies = 0;
  let skippedAlreadySynced = 0;
  let skippedSelfMessages = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const searchResult = await client.search({ since });
      const messageUids = (searchResult || []).slice(-maxMessages);

      if (messageUids.length === 0) {
        return {
          success: true,
          inboxId: decryptedInbox.id,
          inboxEmailAddress: decryptedInbox.emailAddress,
          imap,
          lookedBackDays: lookbackDays,
          scannedMessages,
          matchedReplies,
          newReplies,
          skippedAlreadySynced,
          skippedSelfMessages,
        };
      }

      for await (const message of client.fetch(
        messageUids,
        {
          uid: true,
          envelope: true,
          headers: ["message-id", "in-reply-to", "references", "from", "subject", "date"],
          internalDate: true,
        },
        { uid: true }
      )) {
        scannedMessages++;

        const fromAddresses =
          message.envelope?.from
            ?.map((entry) => entry.address?.trim().toLowerCase())
            .filter((entry): entry is string => Boolean(entry)) ?? [];

        if (fromAddresses.some((entry) => selfAddresses.has(entry))) {
          skippedSelfMessages++;
          continue;
        }

        const rawHeaders = message.headers?.toString("utf8") || "";
        const inboundMessageId =
          message.envelope?.messageId || collectHeaderValues(rawHeaders, "message-id")[0] || null;
        const normalizedInboundMessageId = normalizeMessageReference(inboundMessageId);

        if (normalizedInboundMessageId && knownReplyMessageIds.has(normalizedInboundMessageId)) {
          skippedAlreadySynced++;
          continue;
        }

        const referenceCandidates = new Set<string>();
        for (const value of [
          message.envelope?.inReplyTo || null,
          ...collectHeaderValues(rawHeaders, "in-reply-to"),
          ...collectHeaderValues(rawHeaders, "references"),
        ]) {
          for (const reference of extractMessageReferences(value)) {
            referenceCandidates.add(reference);
          }
        }

        let matchedLog:
          | { id: string; repliedAt: Date | null; sentAt: Date | null }
          | undefined;

        for (const reference of referenceCandidates) {
          matchedLog = logByReference.get(reference);
          if (matchedLog) break;
        }

        if (!matchedLog) {
          continue;
        }

        matchedReplies++;

        if (matchedLog.repliedAt) {
          skippedAlreadySynced++;
          if (normalizedInboundMessageId) {
            knownReplyMessageIds.add(normalizedInboundMessageId);
          }
          continue;
        }

        const occurredAt =
          message.envelope?.date ||
          toDate(message.internalDate) ||
          new Date();

        await recordEmailEvent({
          logId: matchedLog.id,
          eventType: "reply",
          source: "imap",
          occurredAt,
          messageId: inboundMessageId ?? undefined,
          providerMessageId: inboundMessageId ?? undefined,
          payload: {
            kind: "imap_reply_sync",
            mailbox: "INBOX",
            uid: message.uid,
            subject: message.envelope?.subject || collectHeaderValues(rawHeaders, "subject")[0] || null,
            from: fromAddresses,
            inReplyTo:
              message.envelope?.inReplyTo || collectHeaderValues(rawHeaders, "in-reply-to")[0] || null,
            references: [...referenceCandidates],
          } as Prisma.InputJsonValue,
        });

        matchedLog.repliedAt = occurredAt;
        newReplies++;

        if (normalizedInboundMessageId) {
          knownReplyMessageIds.add(normalizedInboundMessageId);
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync replies";
    throw new Error(message);
  } finally {
    await client.logout().catch(() => undefined);
  }

  return {
    success: true,
    inboxId: decryptedInbox.id,
    inboxEmailAddress: decryptedInbox.emailAddress,
    imap,
    lookedBackDays: lookbackDays,
    scannedMessages,
    matchedReplies,
    newReplies,
    skippedAlreadySynced,
    skippedSelfMessages,
  };
}

export async function syncReplyBatch(options: SyncRepliesBatchOptions = {}) {
  const inboxes = await prisma.inbox.findMany({
    where: {
      isActive: true,
      ...(options.userId ? { domain: { userId: options.userId } } : {}),
      ...(options.inboxIds?.length ? { id: { in: options.inboxIds } } : {}),
    },
    select: {
      id: true,
      emailAddress: true,
    },
    orderBy: { createdAt: "asc" },
    take: options.maxInboxes,
  });

  const results: ReplySyncBatchInboxResult[] = [];

  for (const inbox of inboxes) {
    try {
      const result = await syncInboxReplies({
        userId: options.userId,
        inboxId: inbox.id,
        lookbackDays: options.lookbackDays,
        maxMessages: options.maxMessages,
      });

      results.push({
        inboxId: result.inboxId,
        inboxEmailAddress: result.inboxEmailAddress,
        success: true,
        scannedMessages: result.scannedMessages,
        matchedReplies: result.matchedReplies,
        newReplies: result.newReplies,
        skippedAlreadySynced: result.skippedAlreadySynced,
        skippedSelfMessages: result.skippedSelfMessages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync replies";
      results.push({
        inboxId: inbox.id,
        inboxEmailAddress: inbox.emailAddress,
        success: false,
        error: message,
      });
    }
  }

  return {
    success: results.every((result) => result.success),
    totalInboxes: inboxes.length,
    succeededInboxes: results.filter((result) => result.success).length,
    failedInboxes: results.filter((result) => !result.success).length,
    newReplies: results.reduce((total, result) => total + (result.newReplies ?? 0), 0),
    results,
  };
}
