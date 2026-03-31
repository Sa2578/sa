import type { Prisma } from "@prisma/client";
import { guessBounceType, type DeliverabilityEventType } from "./email-events";

export const supportedWebhookProviders = [
  "sendgrid",
  "mailgun",
  "postmark",
  "resend",
  "ses",
] as const;

export type SupportedWebhookProvider = (typeof supportedWebhookProviders)[number];

export interface NormalizedProviderWebhookEvent {
  provider: SupportedWebhookProvider;
  providerEvent: string;
  eventType: DeliverabilityEventType;
  logId?: string | null;
  messageId?: string | null;
  providerMessageId?: string | null;
  occurredAt?: Date;
  failureReason?: string | null;
  bounceType?: string | null;
  smtpResponse?: string | null;
  payload: Prisma.InputJsonValue;
}

export interface NormalizedProviderWebhookResult {
  provider: SupportedWebhookProvider;
  receivedEvents: number;
  ignoredEvents: number;
  events: NormalizedProviderWebhookEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asTrimmedString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function maybeParseJsonString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

async function formDataToObject(req: Request) {
  const formData = await req.formData();
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    const parsedValue =
      typeof value === "string" ? maybeParseJsonString(value) : value.name;

    const existing = result[key];
    if (existing === undefined) {
      result[key] = parsedValue;
      continue;
    }

    result[key] = Array.isArray(existing)
      ? [...existing, parsedValue]
      : [existing, parsedValue];
  }

  return result;
}

export async function parseWebhookRequestBody(req: Request) {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    return req.json();
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    return formDataToObject(req);
  }

  const text = await req.text();
  const parsed = maybeParseJsonString(text);
  if (typeof parsed === "string") {
    throw new Error("Unsupported webhook payload");
  }

  return parsed;
}

function parseOccurredAt(value: unknown) {
  if (value === undefined || value === null) return undefined;

  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isNaN(numericValue) && Number.isFinite(numericValue)) {
    const timestamp = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const textValue = asTrimmedString(value);
  if (!textValue) return undefined;

  const date = new Date(textValue);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function findStringByKeys(value: unknown, candidateKeys: string[], seen = new Set<unknown>()) {
  const normalizedKeys = new Set(candidateKeys.map(normalizeKey));

  const visit = (entry: unknown): string | null => {
    if (!entry || typeof entry !== "object") return null;
    if (seen.has(entry)) return null;
    seen.add(entry);

    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (isRecord(item)) {
          const label = asTrimmedString(item.name ?? item.key ?? item.label);
          const dataValue = item.value ?? item.content ?? item.data;
          if (label && normalizedKeys.has(normalizeKey(label))) {
            const stringValue = asTrimmedString(dataValue);
            if (stringValue) return stringValue;
          }
        }

        const nested = visit(item);
        if (nested) return nested;
      }
      return null;
    }

    for (const [key, rawValue] of Object.entries(entry)) {
      if (normalizedKeys.has(normalizeKey(key))) {
        const stringValue = asTrimmedString(rawValue);
        if (stringValue) return stringValue;

        if (Array.isArray(rawValue)) {
          for (const item of rawValue) {
            const itemValue = asTrimmedString(item);
            if (itemValue) return itemValue;
          }
        }
      }
    }

    for (const rawValue of Object.values(entry)) {
      const nested = visit(rawValue);
      if (nested) return nested;
    }

    return null;
  };

  return visit(value);
}

function toPayload(value: unknown): Prisma.InputJsonValue {
  if (value === null) return {} as Prisma.InputJsonObject;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    isRecord(value)
  ) {
    return value as Prisma.InputJsonValue;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getTrackingIdentifiers(payload: unknown) {
  return {
    logId: findStringByKeys(payload, [
      "outboundcrm_log_id",
      "email_log_id",
      "emailLogId",
      "logId",
      "X-OutboundCRM-Log-Id",
    ]),
    messageId: findStringByKeys(payload, ["message-id", "messageId", "smtp-id", "smtp_id"]),
  };
}

function normalizeSendgridEvent(eventName: string) {
  const normalized = eventName.trim().toLowerCase();
  if (normalized === "processed") return "accepted" as const;
  if (normalized === "delivered") return "delivered" as const;
  if (normalized === "open") return "open" as const;
  if (normalized === "click") return "click" as const;
  if (normalized === "bounce") return "bounce" as const;
  if (normalized === "spamreport") return "spam" as const;
  if (["blocked", "dropped", "deferred"].includes(normalized)) return "failed" as const;
  return null;
}

function normalizeMailgunEvent(eventName: string, payload: Record<string, unknown>) {
  const normalized = eventName.trim().toLowerCase();
  if (["accepted", "stored"].includes(normalized)) return "accepted" as const;
  if (normalized === "delivered") return "delivered" as const;
  if (normalized === "opened") return "open" as const;
  if (normalized === "clicked") return "click" as const;
  if (normalized === "complained") return "spam" as const;
  if (["failed", "rejected"].includes(normalized)) {
    const severity = asTrimmedString(findStringByKeys(payload, ["severity"]));
    return severity?.toLowerCase() === "permanent" ? ("bounce" as const) : ("failed" as const);
  }
  return null;
}

function normalizePostmarkEvent(eventName: string) {
  const normalized = eventName.trim().toLowerCase();
  if (normalized === "delivery") return "delivered" as const;
  if (normalized === "bounce") return "bounce" as const;
  if (normalized === "open") return "open" as const;
  if (normalized === "click") return "click" as const;
  if (normalized === "spamcomplaint") return "spam" as const;
  if (normalized === "inbound") return "reply" as const;
  return null;
}

function normalizeResendEvent(eventName: string) {
  const normalized = eventName.trim().toLowerCase();
  if (normalized === "email.sent") return "accepted" as const;
  if (normalized === "email.delivered") return "delivered" as const;
  if (normalized === "email.opened") return "open" as const;
  if (normalized === "email.clicked") return "click" as const;
  if (normalized === "email.bounced") return "bounce" as const;
  if (normalized === "email.complained") return "spam" as const;
  if (normalized === "email.delivery_delayed") return "failed" as const;
  return null;
}

function normalizeSesEvent(eventName: string) {
  const normalized = eventName.trim().toLowerCase();
  if (normalized === "send") return "accepted" as const;
  if (normalized === "delivery") return "delivered" as const;
  if (normalized === "open") return "open" as const;
  if (normalized === "click") return "click" as const;
  if (normalized === "bounce") return "bounce" as const;
  if (normalized === "complaint") return "spam" as const;
  if (["reject", "rendering failure", "deliverydelay"].includes(normalized)) return "failed" as const;
  return null;
}

function parseSendgridWebhook(body: unknown): NormalizedProviderWebhookResult {
  const items = Array.isArray(body) ? body : [body];
  const events: NormalizedProviderWebhookEvent[] = [];
  let ignoredEvents = 0;

  for (const entry of items) {
    if (!isRecord(entry)) {
      ignoredEvents++;
      continue;
    }

    const providerEvent = asTrimmedString(entry.event ?? entry.type);
    if (!providerEvent) {
      ignoredEvents++;
      continue;
    }

    const eventType = normalizeSendgridEvent(providerEvent);
    if (!eventType) {
      ignoredEvents++;
      continue;
    }

    const identifiers = getTrackingIdentifiers(entry);
    const failureReason =
      asTrimmedString(entry.reason) ||
      asTrimmedString(entry.response) ||
      asTrimmedString(entry.status);

    events.push({
      provider: "sendgrid",
      providerEvent,
      eventType,
      logId: identifiers.logId,
      messageId: identifiers.messageId,
      providerMessageId:
        asTrimmedString(entry.sg_message_id) || asTrimmedString(entry.sg_event_id),
      occurredAt: parseOccurredAt(entry.timestamp),
      failureReason,
      bounceType: guessBounceType(failureReason),
      smtpResponse: asTrimmedString(entry.response),
      payload: toPayload(entry),
    });
  }

  return {
    provider: "sendgrid",
    receivedEvents: items.length,
    ignoredEvents,
    events,
  };
}

function parseMailgunWebhook(body: unknown): NormalizedProviderWebhookResult {
  const root = isRecord(body) ? body : {};
  const eventDataRaw = root["event-data"];
  const eventData = isRecord(eventDataRaw)
    ? eventDataRaw
    : isRecord(maybeParseJsonString(asTrimmedString(eventDataRaw) || ""))
      ? (maybeParseJsonString(asTrimmedString(eventDataRaw) || "") as Record<string, unknown>)
      : root;

  const providerEvent = asTrimmedString(eventData.event);
  const eventType = providerEvent ? normalizeMailgunEvent(providerEvent, eventData) : null;

  if (!providerEvent || !eventType) {
    return {
      provider: "mailgun",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const identifiers = getTrackingIdentifiers(eventData);
  const failureReason =
    asTrimmedString(findStringByKeys(eventData, ["description", "reason"])) ||
    asTrimmedString(findStringByKeys(eventData, ["message"]));

  return {
    provider: "mailgun",
    receivedEvents: 1,
    ignoredEvents: 0,
    events: [
      {
        provider: "mailgun",
        providerEvent,
        eventType,
        logId: identifiers.logId,
        messageId:
          identifiers.messageId ||
          findStringByKeys(eventData, ["message-id", "Message-Id", "message_headers_message-id"]),
        providerMessageId:
          asTrimmedString(eventData.id) || identifiers.messageId || findStringByKeys(eventData, ["id"]),
        occurredAt: parseOccurredAt(eventData.timestamp),
        failureReason,
        bounceType:
          asTrimmedString(findStringByKeys(eventData, ["severity"]))?.toLowerCase() === "temporary"
            ? "soft"
            : guessBounceType(failureReason),
        smtpResponse: asTrimmedString(findStringByKeys(eventData, ["code", "description"])),
        payload: toPayload(root),
      },
    ],
  };
}

function parsePostmarkWebhook(body: unknown): NormalizedProviderWebhookResult {
  if (!isRecord(body)) {
    return {
      provider: "postmark",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const providerEvent = asTrimmedString(body.RecordType);
  const eventType = providerEvent ? normalizePostmarkEvent(providerEvent) : null;

  if (!providerEvent || !eventType) {
    return {
      provider: "postmark",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const identifiers = getTrackingIdentifiers(body);
  const failureReason =
    asTrimmedString(body.Description) ||
    asTrimmedString(body.Details) ||
    asTrimmedString(body.Message);

  return {
    provider: "postmark",
    receivedEvents: 1,
    ignoredEvents: 0,
    events: [
      {
        provider: "postmark",
        providerEvent,
        eventType,
        logId: identifiers.logId,
        messageId: identifiers.messageId || asTrimmedString(body.MessageID),
        providerMessageId: asTrimmedString(body.MessageID),
        occurredAt:
          parseOccurredAt(body.DeliveredAt) ||
          parseOccurredAt(body.BouncedAt) ||
          parseOccurredAt(body.ReceivedAt) ||
          parseOccurredAt(body.RecordedAt),
        failureReason,
        bounceType: guessBounceType(failureReason),
        smtpResponse: asTrimmedString(body.Details),
        payload: toPayload(body),
      },
    ],
  };
}

function parseResendWebhook(body: unknown): NormalizedProviderWebhookResult {
  if (!isRecord(body)) {
    return {
      provider: "resend",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const providerEvent = asTrimmedString(body.type);
  const eventType = providerEvent ? normalizeResendEvent(providerEvent) : null;
  const data = isRecord(body.data) ? body.data : body;

  if (!providerEvent || !eventType) {
    return {
      provider: "resend",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const identifiers = getTrackingIdentifiers(data);
  const failureReason =
    asTrimmedString(findStringByKeys(data, ["reason", "error"])) ||
    asTrimmedString(findStringByKeys(data, ["response"]));

  return {
    provider: "resend",
    receivedEvents: 1,
    ignoredEvents: 0,
    events: [
      {
        provider: "resend",
        providerEvent,
        eventType,
        logId: identifiers.logId,
        messageId: identifiers.messageId,
        providerMessageId:
          asTrimmedString(findStringByKeys(data, ["email_id", "emailId", "id"])) || identifiers.messageId,
        occurredAt: parseOccurredAt(data.created_at ?? body.created_at),
        failureReason,
        bounceType: guessBounceType(failureReason),
        smtpResponse: asTrimmedString(findStringByKeys(data, ["response"])),
        payload: toPayload(body),
      },
    ],
  };
}

function parseSesNotification(body: unknown) {
  if (!isRecord(body)) return null;

  const message = body.Message;
  if (typeof message === "string") {
    const parsed = maybeParseJsonString(message);
    if (isRecord(parsed)) {
      return parsed;
    }
  }

  return body;
}

function parseSesWebhook(body: unknown): NormalizedProviderWebhookResult {
  const notification = parseSesNotification(body);
  if (!notification) {
    return {
      provider: "ses",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const providerEvent =
    asTrimmedString(notification.eventType) || asTrimmedString(notification.notificationType);
  const eventType = providerEvent ? normalizeSesEvent(providerEvent) : null;
  const mail = isRecord(notification.mail) ? notification.mail : {};

  if (!providerEvent || !eventType) {
    return {
      provider: "ses",
      receivedEvents: 1,
      ignoredEvents: 1,
      events: [],
    };
  }

  const identifiers = getTrackingIdentifiers(notification);
  const failureReason =
    asTrimmedString(findStringByKeys(notification, ["diagnosticcode", "status", "feedbacktype"])) ||
    asTrimmedString(findStringByKeys(notification, ["description", "message"]));

  return {
    provider: "ses",
    receivedEvents: 1,
    ignoredEvents: 0,
    events: [
      {
        provider: "ses",
        providerEvent,
        eventType,
        logId: identifiers.logId,
        messageId: identifiers.messageId || findStringByKeys(mail, ["message-id", "messageId"]),
        providerMessageId: asTrimmedString(mail.messageId) || identifiers.messageId,
        occurredAt:
          parseOccurredAt(findStringByKeys(notification, ["timestamp"])) ||
          parseOccurredAt(mail.timestamp),
        failureReason,
        bounceType: guessBounceType(failureReason),
        smtpResponse: asTrimmedString(findStringByKeys(notification, ["smtpResponse", "reportingMTA"])),
        payload: toPayload(notification),
      },
    ],
  };
}

export function normalizeProviderWebhook(
  provider: SupportedWebhookProvider,
  body: unknown
): NormalizedProviderWebhookResult {
  switch (provider) {
    case "sendgrid":
      return parseSendgridWebhook(body);
    case "mailgun":
      return parseMailgunWebhook(body);
    case "postmark":
      return parsePostmarkWebhook(body);
    case "resend":
      return parseResendWebhook(body);
    case "ses":
      return parseSesWebhook(body);
  }
}
