import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWebhookSecret } from "@/lib/env";
import { recordEmailEvent, type DeliverabilityEventType, guessBounceType } from "@/lib/email-events";
import {
  buildTrackingRequestContext,
  classifyOpenTrackingRequest,
} from "@/lib/tracking";
import { prisma } from "@/lib/prisma";

function isAuthorized(req: Request) {
  const expectedSecret = getWebhookSecret();
  if (!expectedSecret) return true;

  const suppliedSecret =
    req.headers.get("x-webhook-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return suppliedSecret === expectedSecret;
}

function normalizeEventType(value: string | null | undefined): DeliverabilityEventType | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("deliver")) return "delivered";
  if (normalized.includes("open")) return "open";
  if (normalized.includes("click")) return "click";
  if (normalized.includes("bounce")) return "bounce";
  if (normalized.includes("complaint") || normalized.includes("spam")) return "spam";
  if (normalized.includes("reply")) return "reply";
  if (normalized.includes("fail") || normalized.includes("reject")) return "failed";
  if (normalized.includes("accept") || normalized.includes("sent")) return "accepted";

  const map: Record<string, DeliverabilityEventType> = {
    accepted: "accepted",
    sent: "accepted",
    queued: "accepted",
    delivered: "delivered",
    delivery: "delivered",
    open: "open",
    opened: "open",
    click: "click",
    clicked: "click",
    bounce: "bounce",
    bounced: "bounce",
    spam: "spam",
    complaint: "spam",
    complained: "spam",
    reply: "reply",
    replied: "reply",
    failed: "failed",
    reject: "failed",
    rejected: "failed",
  };

  return map[normalized] ?? null;
}

function parseOccurredAt(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const occurredAt = new Date(value);
  return Number.isNaN(occurredAt.getTime()) ? undefined : occurredAt;
}

function extractIdentifiers(payload: Record<string, unknown>) {
  return {
    logId:
      typeof payload.logId === "string"
        ? payload.logId
        : typeof payload.emailLogId === "string"
          ? payload.emailLogId
          : undefined,
    messageId:
      typeof payload.messageId === "string"
        ? payload.messageId
        : typeof payload.smtpMessageId === "string"
          ? payload.smtpMessageId
          : undefined,
    providerMessageId:
      typeof payload.providerMessageId === "string"
        ? payload.providerMessageId
        : typeof payload.eventId === "string"
          ? payload.eventId
          : undefined,
  };
}

function extractEventType(payload: Record<string, unknown>) {
  return (
    normalizeEventType(typeof payload.event === "string" ? payload.event : null) ||
    normalizeEventType(typeof payload.type === "string" ? payload.type : null) ||
    normalizeEventType(typeof payload.status === "string" ? payload.status : null)
  );
}

function buildTransparentPixel() {
  return Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
}

async function findEmailLogForTracking(identifiers: {
  logId?: string;
  messageId?: string;
  providerMessageId?: string;
}) {
  if (identifiers.logId) {
    return prisma.emailLog.findUnique({
      where: { id: identifiers.logId },
      select: {
        id: true,
        status: true,
        sentAt: true,
        messageId: true,
        providerMessageId: true,
      },
    });
  }

  if (identifiers.providerMessageId) {
    return prisma.emailLog.findFirst({
      where: { providerMessageId: identifiers.providerMessageId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        sentAt: true,
        messageId: true,
        providerMessageId: true,
      },
    });
  }

  if (identifiers.messageId) {
    return prisma.emailLog.findFirst({
      where: { messageId: identifiers.messageId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        sentAt: true,
        messageId: true,
        providerMessageId: true,
      },
    });
  }

  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const identifiers = {
    logId: searchParams.get("logId") || undefined,
    messageId: searchParams.get("messageId") || undefined,
    providerMessageId: searchParams.get("providerMessageId") || undefined,
  };
  const eventType = normalizeEventType(searchParams.get("event"));
  const targetUrl = searchParams.get("url");

  if (!eventType) {
    return new NextResponse("Unknown event", { status: 400 });
  }

  if (!identifiers.logId && !identifiers.messageId && !identifiers.providerMessageId) {
    return new NextResponse("Missing identifiers", { status: 400 });
  }

  try {
    const emailLog = await findEmailLogForTracking(identifiers);
    if (!emailLog) {
      return new NextResponse("Email log not found", { status: 400 });
    }

    const trackingContext = buildTrackingRequestContext(req);
    const payload = {
      query: Object.fromEntries(searchParams.entries()),
      trackingRequest: trackingContext,
    };

    if (eventType === "open") {
      const classification = classifyOpenTrackingRequest(req, emailLog.sentAt);

      if (classification.suspicious) {
        await prisma.emailEvent.create({
          data: {
            emailLogId: emailLog.id,
            eventType: "open_suspected",
            source: "tracking",
            occurredAt: new Date(),
            messageId: emailLog.messageId,
            providerMessageId: emailLog.providerMessageId,
            payload: {
              ...payload,
              openClassification: {
                suspicious: true,
                reasons: classification.reasons,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        await recordEmailEvent({
          logId: emailLog.id,
          eventType,
          source: "tracking",
          payload: {
            ...payload,
            openClassification: {
              suspicious: false,
              reasons: [],
            },
          } as unknown as Prisma.InputJsonValue,
        });
      }
    } else {
      await recordEmailEvent({
        logId: emailLog.id,
        eventType,
        source: "tracking",
        payload: payload as unknown as Prisma.InputJsonValue,
      });
    }

    if (eventType === "open") {
      return new NextResponse(buildTransparentPixel(), {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (eventType === "click" && targetUrl) {
      return NextResponse.redirect(targetUrl);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return new NextResponse(message, { status: message === "Email log not found" ? 400 : 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    const payload = (await req.json()) as Record<string, unknown>;
    const identifiers = extractIdentifiers(payload);
    const eventType = extractEventType(payload);

    if (!eventType) {
      return NextResponse.json({ error: "Unknown event" }, { status: 400 });
    }

    if (!identifiers.logId && !identifiers.messageId && !identifiers.providerMessageId) {
      return NextResponse.json({ error: "Missing identifiers" }, { status: 400 });
    }

    const failureReason =
      typeof payload.reason === "string"
        ? payload.reason
        : typeof payload.error === "string"
          ? payload.error
          : typeof payload.response === "string"
            ? payload.response
            : null;

    const updated = await recordEmailEvent({
      ...identifiers,
      eventType,
      source: "webhook",
      occurredAt: parseOccurredAt(payload.occurredAt ?? payload.timestamp),
      failureReason,
      bounceType:
        typeof payload.bounceType === "string"
          ? payload.bounceType
          : guessBounceType(failureReason),
      payload: payload as Prisma.InputJsonValue,
    });

    return NextResponse.json({ success: true, emailLogId: updated?.id ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    const status = message === "Unknown event" || message === "Email log not found" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
