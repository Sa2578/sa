import { ImapFlow, type ListResponse } from "imapflow";
import { prisma } from "./prisma";
import {
  detectMailboxProvider,
  resolveImapConfig,
  resolveMonitoringMailboxImapConfig,
} from "./imap-config";
import {
  type HeaderPlacement,
  persistHeaderAnalysis,
} from "./header-analysis-persistence";
import {
  decryptInboxCredentials,
  getInboxCredentialUpgrade,
} from "./smtp-credentials";
import {
  decryptMonitoringMailboxCredentials,
  getMonitoringMailboxCredentialUpgrade,
} from "./monitoring-mailboxes";

interface EmailLogForPlacementSync {
  id: string;
  sentAt: Date | null;
  messageId: string | null;
  providerMessageId: string | null;
  lead: {
    email: string;
  };
}

interface MailboxPlacementCandidate {
  path: string;
  placement: HeaderPlacement;
  specialUse: string | null;
  priority: number;
}

const JUNK_NAME_PATTERNS = [
  /^spam$/i,
  /^junk$/i,
  /^junk e-?mail$/i,
  /^bulk$/i,
  /^bulk mail$/i,
  /^correo no deseado$/i,
];

function normalizeMessageReference(value?: string | null) {
  if (!value) return null;
  return value.replace(/[<>]/g, "").trim().toLowerCase() || null;
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

function getMailboxPlacementCandidate(mailbox: ListResponse): MailboxPlacementCandidate | null {
  if (mailbox.specialUse === "\\Junk") {
    return {
      path: mailbox.path,
      placement: "SPAM",
      specialUse: mailbox.specialUse,
      priority: 0,
    };
  }

  if (
    mailbox.specialUse === "\\Inbox" ||
    mailbox.path.toUpperCase() === "INBOX" ||
    mailbox.name.toUpperCase() === "INBOX"
  ) {
    return {
      path: mailbox.path,
      placement: "INBOX",
      specialUse: mailbox.specialUse || "\\Inbox",
      priority: 2,
    };
  }

  if (JUNK_NAME_PATTERNS.some((pattern) => pattern.test(mailbox.name))) {
    return {
      path: mailbox.path,
      placement: "SPAM",
      specialUse: mailbox.specialUse || null,
      priority: 1,
    };
  }

  return null;
}

function getCandidateMailboxes(mailboxes: ListResponse[]) {
  return mailboxes
    .map(getMailboxPlacementCandidate)
    .filter((entry): entry is MailboxPlacementCandidate => Boolean(entry))
    .sort((left, right) => left.priority - right.priority)
    .filter(
      (entry, index, items) =>
        items.findIndex((candidate) => candidate.path === entry.path) === index
    );
}

function normalizeMailboxPath(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

function prioritizeMailboxHints(
  candidates: MailboxPlacementCandidate[],
  hints: { inboxFolderHint?: string | null; spamFolderHint?: string | null }
) {
  const inboxHint = normalizeMailboxPath(hints.inboxFolderHint);
  const spamHint = normalizeMailboxPath(hints.spamFolderHint);

  function getHintPriority(candidate: MailboxPlacementCandidate) {
    const path = normalizeMailboxPath(candidate.path);
    if (inboxHint && path === inboxHint) return -2;
    if (spamHint && path === spamHint) return -2;
    return 0;
  }

  return [...candidates].sort((left, right) => {
    const leftPriority = getHintPriority(left);
    const rightPriority = getHintPriority(right);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.priority - right.priority;
  });
}

function matchesEmailLog(rawHeaders: string, emailLog: EmailLogForPlacementSync) {
  const logHeader =
    collectHeaderValues(rawHeaders, "x-outboundcrm-log-id")[0]?.trim() || null;
  if (logHeader === emailLog.id) {
    return "x-outboundcrm-log-id";
  }

  const targetMessageIds = new Set(
    [emailLog.messageId, emailLog.providerMessageId]
      .map((value) => normalizeMessageReference(value))
      .filter((value): value is string => Boolean(value))
  );

  const messageIds = collectHeaderValues(rawHeaders, "message-id")
    .map((value) => normalizeMessageReference(value))
    .filter((value): value is string => Boolean(value));

  if (messageIds.some((value) => targetMessageIds.has(value))) {
    return "message-id";
  }

  return null;
}

async function loadEmailLog(userId: string, senderInboxId: string, emailLogId: string) {
  return prisma.emailLog.findFirst({
    where: {
      id: emailLogId,
      inboxId: senderInboxId,
      inbox: {
        domain: {
          userId,
        },
      },
    },
    select: {
      id: true,
      subject: true,
      sentAt: true,
      messageId: true,
      providerMessageId: true,
      lead: {
        select: {
          email: true,
        },
      },
    },
  });
}

async function loadRecipientInbox(userId: string, recipientEmail: string) {
  return prisma.inbox.findFirst({
    where: {
      emailAddress: recipientEmail,
      domain: {
        userId,
      },
    },
    select: {
      id: true,
      emailAddress: true,
      smtpHost: true,
      smtpUser: true,
      smtpPass: true,
      domain: {
        select: {
          domainName: true,
        },
      },
    },
  });
}

async function loadMonitoringMailbox(userId: string, recipientEmail: string) {
  return prisma.monitoringMailbox.findFirst({
    where: {
      userId,
      emailAddress: recipientEmail,
      isActive: true,
      usage: {
        in: ["PLACEMENT", "BOTH"],
      },
    },
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      usage: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapUser: true,
      imapPass: true,
      inboxFolderHint: true,
      spamFolderHint: true,
    },
  });
}

export async function syncMailboxPlacementForEmailLog(options: {
  userId: string;
  senderInboxId: string;
  emailLogId: string;
  lookbackDays?: number;
  maxMessagesPerMailbox?: number;
}) {
  const { userId, senderInboxId, emailLogId, lookbackDays = 7, maxMessagesPerMailbox = 200 } =
    options;

  const emailLog = await loadEmailLog(userId, senderInboxId, emailLogId);
  if (!emailLog) {
    throw new Error("Email log not found");
  }

  const recipientInbox = await loadRecipientInbox(userId, emailLog.lead.email);
  const monitoringMailbox = recipientInbox
    ? null
    : await loadMonitoringMailbox(userId, emailLog.lead.email);

  if (!recipientInbox && !monitoringMailbox) {
    throw new Error(
      "Recipient mailbox is not configured as a managed inbox or monitoring mailbox in this account"
    );
  }

  let mailboxProvider = "custom";
  let recipientMailboxId: string;
  let recipientMailboxEmailAddress: string;
  let imap: { host: string; port: number; secure: boolean };
  let authUser: string;
  let authPass: string;
  let folderHints: { inboxFolderHint?: string | null; spamFolderHint?: string | null } = {};
  const monitoringMailboxId = monitoringMailbox?.id || null;

  async function updateMonitoringMailboxCheckState(data: {
    lastCheckError: string | null;
  }) {
    if (!monitoringMailboxId) {
      return;
    }

    await prisma.monitoringMailbox.update({
      where: { id: monitoringMailboxId },
      data: {
        lastCheckedAt: new Date(),
        lastCheckError: data.lastCheckError,
      },
    });
  }

  if (recipientInbox) {
    const credentialUpgrade = getInboxCredentialUpgrade(recipientInbox);
    if (Object.keys(credentialUpgrade).length > 0) {
      await prisma.inbox.update({
        where: { id: recipientInbox.id },
        data: credentialUpgrade,
      });
    }

    const decryptedRecipientInbox = decryptInboxCredentials(recipientInbox);
    imap = resolveImapConfig(decryptedRecipientInbox);
    mailboxProvider = detectMailboxProvider(decryptedRecipientInbox);
    recipientMailboxId = recipientInbox.id;
    recipientMailboxEmailAddress = recipientInbox.emailAddress;
    authUser = decryptedRecipientInbox.smtpUser;
    authPass = decryptedRecipientInbox.smtpPass;
  } else {
    const credentialUpgrade = getMonitoringMailboxCredentialUpgrade(monitoringMailbox!);
    if (Object.keys(credentialUpgrade).length > 0) {
      await prisma.monitoringMailbox.update({
        where: { id: monitoringMailbox!.id },
        data: credentialUpgrade,
      });
    }

    const decryptedMonitoringMailbox = decryptMonitoringMailboxCredentials(monitoringMailbox!);
    imap = resolveMonitoringMailboxImapConfig(monitoringMailbox!);
    mailboxProvider = monitoringMailbox!.provider;
    recipientMailboxId = monitoringMailbox!.id;
    recipientMailboxEmailAddress = monitoringMailbox!.emailAddress;
    authUser = decryptedMonitoringMailbox.imapUser;
    authPass = decryptedMonitoringMailbox.imapPass;
    folderHints = {
      inboxFolderHint: monitoringMailbox!.inboxFolderHint,
      spamFolderHint: monitoringMailbox!.spamFolderHint,
    };
  }

  const since = emailLog.sentAt
    ? new Date(Math.max(emailLog.sentAt.getTime() - 60 * 60 * 1000, Date.now() - lookbackDays * 24 * 60 * 60 * 1000))
    : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: {
      user: authUser,
      pass: authPass,
    },
    logger: false,
    disableAutoIdle: true,
  });

  const checkedMailboxes: string[] = [];

  try {
    await client.connect();
    const candidateMailboxes = prioritizeMailboxHints(
      getCandidateMailboxes(await client.list()),
      folderHints
    );

    if (candidateMailboxes.length === 0) {
      throw new Error("No inbox or spam folders were discovered for the recipient mailbox");
    }

    for (const mailbox of candidateMailboxes) {
      checkedMailboxes.push(mailbox.path);
      const lock = await client.getMailboxLock(mailbox.path, { readOnly: true });

      try {
        const searchResult = await client.search({ since });
        const messageUids = (searchResult || []).slice(-maxMessagesPerMailbox).reverse();

        if (messageUids.length === 0) {
          continue;
        }

        for await (const message of client.fetch(
          messageUids,
          {
            uid: true,
            envelope: true,
            internalDate: true,
            headers: true,
          },
          { uid: true }
        )) {
          const rawHeaders = message.headers?.toString("utf8") || "";
          if (!rawHeaders) {
            continue;
          }

          const matchedBy = matchesEmailLog(rawHeaders, emailLog);
          if (!matchedBy) {
            continue;
          }

          const persisted = await persistHeaderAnalysis({
            emailLogId: emailLog.id,
            rawHeaders,
            placement: mailbox.placement,
            userId,
            mailboxProvider,
            source: "imap",
            payloadMetadata: {
              mailboxPath: mailbox.path,
              mailboxSpecialUse: mailbox.specialUse,
              recipientInboxId: recipientMailboxId,
              recipientInboxEmailAddress: recipientMailboxEmailAddress,
              recipientMailboxKind: recipientInbox ? "sending_inbox" : "monitoring_mailbox",
              matchStrategy: matchedBy,
              mailboxMessageUid: message.uid ?? null,
              mailboxInternalDate:
                message.internalDate instanceof Date
                  ? message.internalDate.toISOString()
                  : null,
            },
          });

          await updateMonitoringMailboxCheckState({ lastCheckError: null });

          return {
            success: true,
            found: true,
            persisted: persisted.persisted,
            emailLogId: emailLog.id,
            mailboxProvider,
            mailboxPath: mailbox.path,
            mailboxSpecialUse: mailbox.specialUse,
            placement: mailbox.placement,
            checkedMailboxes,
            recipientMailboxKind: recipientInbox ? "sending_inbox" : "monitoring_mailbox",
            analysis: persisted.analysis,
            matchedBy,
          };
        }
      } finally {
        lock.release();
      }
    }
    await updateMonitoringMailboxCheckState({ lastCheckError: null });
  } catch (error) {
    await updateMonitoringMailboxCheckState({
      lastCheckError: error instanceof Error ? error.message : "Unknown IMAP placement sync error",
    });
    throw error;
  } finally {
    await client.logout().catch(() => undefined);
  }

  return {
    success: true,
    found: false,
    emailLogId: emailLog.id,
    mailboxProvider,
    checkedMailboxes,
    recipientMailboxKind: recipientInbox ? "sending_inbox" : "monitoring_mailbox",
  };
}
