import { getEmailDomain } from "./provider-detection";

interface InboxImapConfigSource {
  emailAddress: string;
  smtpHost: string;
  domain?: {
    domainName: string;
  } | null;
}

interface MonitoringMailboxImapConfigSource {
  emailAddress: string;
  provider?: string | null;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
}

export function resolveImapConfig(inbox: InboxImapConfigSource) {
  const emailDomain = getEmailDomain(inbox.emailAddress) || inbox.domain?.domainName || "";
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

export function detectMailboxProvider(inbox: InboxImapConfigSource) {
  const emailDomain = getEmailDomain(inbox.emailAddress) || "";
  const smtpHost = inbox.smtpHost.toLowerCase();

  if (smtpHost.includes("gmail") || emailDomain === "gmail.com") return "gmail";
  if (
    smtpHost.includes("outlook") ||
    smtpHost.includes("office365") ||
    ["outlook.com", "hotmail.com", "live.com"].includes(emailDomain)
  ) {
    return "outlook";
  }
  if (smtpHost.includes("yahoo") || emailDomain.endsWith("yahoo.com")) return "yahoo";
  if (smtpHost.includes("zoho") || emailDomain.endsWith("zoho.com")) return "zoho";
  if (smtpHost.includes("icloud") || emailDomain === "icloud.com") return "icloud";

  return emailDomain || inbox.domain?.domainName || "custom";
}

export function resolveMonitoringMailboxImapConfig(mailbox: MonitoringMailboxImapConfigSource) {
  if (mailbox.imapHost) {
    return {
      host: mailbox.imapHost,
      port: mailbox.imapPort || 993,
      secure: mailbox.imapSecure ?? true,
    };
  }

  const provider = mailbox.provider?.toLowerCase() || "";
  if (provider === "gmail") {
    return { host: "imap.gmail.com", port: mailbox.imapPort || 993, secure: mailbox.imapSecure ?? true };
  }
  if (provider === "outlook") {
    return {
      host: "outlook.office365.com",
      port: mailbox.imapPort || 993,
      secure: mailbox.imapSecure ?? true,
    };
  }
  if (provider === "yahoo") {
    return {
      host: "imap.mail.yahoo.com",
      port: mailbox.imapPort || 993,
      secure: mailbox.imapSecure ?? true,
    };
  }
  if (provider === "zoho") {
    return { host: "imap.zoho.com", port: mailbox.imapPort || 993, secure: mailbox.imapSecure ?? true };
  }
  if (provider === "icloud") {
    return { host: "imap.mail.me.com", port: mailbox.imapPort || 993, secure: mailbox.imapSecure ?? true };
  }

  return {
    ...resolveImapConfig({
      emailAddress: mailbox.emailAddress,
      smtpHost: mailbox.imapHost || "",
    }),
    port: mailbox.imapPort || 993,
    secure: mailbox.imapSecure ?? true,
  };
}
