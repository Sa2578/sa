const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const YAHOO_DOMAINS = new Set(["yahoo.com", "ymail.com", "rocketmail.com"]);
const OUTLOOK_DOMAINS = new Set([
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "passport.com",
]);
const APPLE_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);
const ZOHO_DOMAINS = new Set(["zoho.com", "zohomail.com"]);
const AOL_DOMAINS = new Set(["aol.com"]);

function normalizeDomain(value?: string | null) {
  return value?.trim().toLowerCase().replace(/^\.+|\.+$/g, "") || "";
}

export function getEmailDomain(email?: string | null) {
  const trimmed = email?.trim().toLowerCase() || "";
  if (!trimmed.includes("@")) {
    return "";
  }

  return normalizeDomain(trimmed.split("@")[1]);
}

export function classifyRecipientProvider(email?: string | null) {
  const domain = getEmailDomain(email);

  if (!domain) return "unknown";
  if (GMAIL_DOMAINS.has(domain)) return "gmail";
  if (YAHOO_DOMAINS.has(domain) || domain.startsWith("yahoo.") || domain.includes(".yahoo.")) {
    return "yahoo";
  }
  if (OUTLOOK_DOMAINS.has(domain)) return "outlook";
  if (APPLE_DOMAINS.has(domain)) return "apple";
  if (ZOHO_DOMAINS.has(domain) || domain.endsWith(".zoho.com")) return "zoho";
  if (AOL_DOMAINS.has(domain)) return "aol";

  return "custom";
}

export function detectSendingHostProvider(options: {
  smtpHost?: string | null;
  emailAddress?: string | null;
}) {
  const smtpHost = normalizeDomain(options.smtpHost);
  const emailDomain = getEmailDomain(options.emailAddress);

  if (
    smtpHost.includes("gmail") ||
    smtpHost.includes("googlemail") ||
    smtpHost.includes("google.com") ||
    smtpHost.includes("smtp-relay.gmail")
  ) {
    return "google-workspace";
  }

  if (
    smtpHost.includes("outlook") ||
    smtpHost.includes("office365") ||
    smtpHost.includes("hotmail") ||
    smtpHost.includes("protection.outlook")
  ) {
    return "microsoft-365";
  }

  if (smtpHost.includes("yahoo")) return "yahoo";
  if (smtpHost.includes("zoho")) return "zoho";
  if (smtpHost.includes("icloud") || smtpHost.includes("me.com")) return "icloud";
  if (smtpHost.includes("sendgrid")) return "sendgrid";
  if (smtpHost.includes("mailgun")) return "mailgun";
  if (smtpHost.includes("postmark")) return "postmark";
  if (smtpHost.includes("amazonses") || smtpHost.includes("amazonaws")) return "amazon-ses";
  if (smtpHost.includes("resend")) return "resend";

  if (GMAIL_DOMAINS.has(emailDomain)) return "google-workspace";
  if (OUTLOOK_DOMAINS.has(emailDomain)) return "microsoft-365";
  if (YAHOO_DOMAINS.has(emailDomain)) return "yahoo";
  if (ZOHO_DOMAINS.has(emailDomain)) return "zoho";
  if (APPLE_DOMAINS.has(emailDomain)) return "icloud";

  return smtpHost || emailDomain || "custom-smtp";
}

export function formatProviderLabel(provider?: string | null) {
  switch (provider) {
    case "gmail":
      return "Gmail";
    case "yahoo":
      return "Yahoo";
    case "outlook":
      return "Outlook";
    case "apple":
      return "Apple Mail";
    case "zoho":
      return "Zoho";
    case "aol":
      return "AOL";
    case "custom":
      return "Custom Domain";
    case "unknown":
      return "Unknown";
    case "google-workspace":
      return "Google Workspace";
    case "microsoft-365":
      return "Microsoft 365";
    case "icloud":
      return "iCloud";
    case "sendgrid":
      return "SendGrid";
    case "mailgun":
      return "Mailgun";
    case "postmark":
      return "Postmark";
    case "amazon-ses":
      return "Amazon SES";
    case "resend":
      return "Resend";
    case "custom-smtp":
      return "Custom SMTP";
    default:
      if (!provider) return "Unknown";
      return provider
        .split(/[-_.]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}
