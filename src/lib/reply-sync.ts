import type { Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { prisma } from "./prisma";
import { recordEmailEvent } from "./email-events";

interface SyncRepliesOptions {
  userId?: string;
  inboxId?: string;
  inboxEmailAddress?: string;
  lookbackDays?: number;
  maxMessages?: number;
}

interface InboxForReplySync {
  id: string;
  emailAddress: string;
  replyToEmail: string | null;
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
  domain: {
    domainName: string;
    userId: string;
  };
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

function resolveImapConfig(inbox: InboxForReplySync) {
  const emailDomain = inbox.emailAddress.split("@")[1]?.toLowerCase() || inbox.domain.domainName;
  const smtpHost = inbox.smtpHost.toLowerCase();

  if (smtpHost.includes("gmail.com") || emailDomain === "gmail.com") {
    return { host: "imap.gmail.com", port: 993, secure: true };
  }

  if (
    smtpHost.includes("outlook") ||
    smtpHost.includes("office365") ||
    ["outlook.com", "hotmail.com", "live.com"].includes(emailDomain)
  ) {
    return { host: "outlook.office365.com", port: 993, secure: true };
  }

  if (smtpHost.includes("yahoo") || emailDomain.endsWith("yahoo.com")) {
    return { host: "imap.mail.yahoo.com", port: 993, secure: true };
  }

  if (smtpHost.includes("zoho") || emailDomain.endsWith("zoho.com")) {
    return { host: "imap.zoho.com", port: 993, secure: true };
  }

  if (smtpHost.startsWith("smtp.")) {
    return { host: `imap.${smtpHost.slice(5)}`, port: 993, secure: true };
  }

  return { host: `imap.${emailDomain}`, port: 993, secure: true };
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

  const candidateLogs = await prisma.emailLog.findMany({
    where: {
      inboxId: inbox.id,
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
      emailLog: { inboxId: inbox.id },
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
    [inbox.emailAddress, inbox.replyToEmail, inbox.smtpUser]
      .filter(Boolean)
      .map((entry) => entry!.trim().toLowerCase())
  );

  const imap = resolveImapConfig(inbox);
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: {
      user: inbox.smtpUser,
      pass: inbox.smtpPass,
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
          inboxId: inbox.id,
          inboxEmailAddress: inbox.emailAddress,
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
    inboxId: inbox.id,
    inboxEmailAddress: inbox.emailAddress,
    imap,
    lookedBackDays: lookbackDays,
    scannedMessages,
    matchedReplies,
    newReplies,
    skippedAlreadySynced,
    skippedSelfMessages,
  };
}
