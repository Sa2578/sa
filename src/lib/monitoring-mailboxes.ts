import { z } from "zod";
import { encryptSmtpCredential, decryptSmtpCredential } from "./smtp-credentials";
import { classifyRecipientProvider, getEmailDomain } from "./provider-detection";
import { resolveMonitoringMailboxImapConfig } from "./imap-config";

export const monitoringMailboxUsageSchema = z.enum(["PLACEMENT", "FEEDBACK_LOOP", "BOTH"]);

export const monitoringMailboxSchema = z.object({
  emailAddress: z.string().email(),
  provider: z.string().trim().min(1).max(64).optional(),
  usage: monitoringMailboxUsageSchema.default("PLACEMENT"),
  imapHost: z.string().trim().min(1).max(255).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.coerce.boolean().optional(),
  imapUser: z.string().trim().min(1),
  imapPass: z.string().min(1),
  inboxFolderHint: z.string().trim().max(255).optional(),
  spamFolderHint: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const monitoringMailboxUpdateSchema = monitoringMailboxSchema.partial();

function inferProvider(emailAddress: string, provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  if (normalized) {
    return normalized;
  }

  const inferred = classifyRecipientProvider(emailAddress);
  return inferred === "unknown" ? getEmailDomain(emailAddress) || "custom" : inferred;
}

export function normalizeMonitoringMailboxInput(
  input: z.infer<typeof monitoringMailboxSchema> | z.infer<typeof monitoringMailboxUpdateSchema>
) {
  const provider =
    typeof input.emailAddress === "string"
      ? inferProvider(input.emailAddress, input.provider)
      : input.provider?.trim().toLowerCase();

  const resolvedConfig =
    typeof input.emailAddress === "string"
      ? resolveMonitoringMailboxImapConfig({
          emailAddress: input.emailAddress,
          provider,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
        })
      : null;

  return {
    ...input,
    provider,
    imapHost: input.imapHost?.trim() || resolvedConfig?.host,
    imapPort: input.imapPort ?? resolvedConfig?.port ?? 993,
    imapSecure: input.imapSecure ?? resolvedConfig?.secure ?? true,
    inboxFolderHint: input.inboxFolderHint?.trim() || null,
    spamFolderHint: input.spamFolderHint?.trim() || null,
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? true,
  };
}

export function encryptMonitoringMailboxCredentials(data: {
  imapUser: string;
  imapPass: string;
}) {
  return {
    imapUser: encryptSmtpCredential(data.imapUser),
    imapPass: encryptSmtpCredential(data.imapPass),
  };
}

export function decryptMonitoringMailboxCredentials(data: {
  imapUser: string;
  imapPass: string;
}) {
  return {
    imapUser: decryptSmtpCredential(data.imapUser),
    imapPass: decryptSmtpCredential(data.imapPass),
  };
}

export function getMonitoringMailboxCredentialUpgrade(data: {
  imapUser?: string | null;
  imapPass?: string | null;
}) {
  const upgrade: { imapUser?: string; imapPass?: string } = {};

  if (data.imapUser && !data.imapUser.startsWith("enc-v1:")) {
    upgrade.imapUser = encryptSmtpCredential(data.imapUser);
  }

  if (data.imapPass && !data.imapPass.startsWith("enc-v1:")) {
    upgrade.imapPass = encryptSmtpCredential(data.imapPass);
  }

  return upgrade;
}

export function serializeMonitoringMailbox(mailbox: {
  id: string;
  emailAddress: string;
  provider: string;
  usage: string;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  inboxFolderHint: string | null;
  spamFolderHint: string | null;
  notes: string | null;
  isActive: boolean;
  lastCheckedAt: Date | null;
  lastCheckError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...mailbox,
    lastCheckedAt: mailbox.lastCheckedAt?.toISOString() || null,
    createdAt: mailbox.createdAt.toISOString(),
    updatedAt: mailbox.updatedAt.toISOString(),
  };
}
