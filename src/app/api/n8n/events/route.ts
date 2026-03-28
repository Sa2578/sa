import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  guessBounceType,
  recordEmailEvent,
  type DeliverabilityEventType,
} from "@/lib/email-events";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

const eventSchema = z.object({
  event: z.string().trim().optional(),
  type: z.string().trim().optional(),
  status: z.string().trim().optional(),
  logId: z.string().trim().min(1).optional(),
  emailLogId: z.string().trim().min(1).optional(),
  messageId: z.string().trim().min(1).optional(),
  providerMessageId: z.string().trim().min(1).optional(),
  eventId: z.string().trim().min(1).optional(),
  occurredAt: z.union([z.string(), z.number()]).optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  reason: z.string().trim().optional(),
  error: z.string().trim().optional(),
  response: z.string().trim().optional(),
  smtpResponse: z.string().trim().optional(),
  bounceType: z.string().trim().optional(),
  payload: z.any().optional(),
});

function normalizeEventType(value: string | undefined): DeliverabilityEventType | null {
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

  return null;
}

function parseOccurredAt(value: string | number | undefined) {
  if (value === undefined) return undefined;
  const occurredAt = new Date(value);
  return Number.isNaN(occurredAt.getTime()) ? undefined : occurredAt;
}

export async function POST(req: Request) {
  try {
    if (!isWebhookAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = eventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const data = parsed.data;
    const eventType =
      normalizeEventType(data.event) ||
      normalizeEventType(data.type) ||
      normalizeEventType(data.status);

    if (!eventType) {
      return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
    }

    const logId = data.logId || data.emailLogId;
    const providerMessageId = data.providerMessageId || data.eventId;

    if (!logId && !data.messageId && !providerMessageId) {
      return NextResponse.json(
        { error: "Missing logId, messageId or providerMessageId" },
        { status: 400 }
      );
    }

    const failureReason = data.reason || data.error || data.response || null;
    const updated = await recordEmailEvent({
      logId,
      messageId: data.messageId,
      providerMessageId,
      eventType,
      source: "webhook",
      occurredAt: parseOccurredAt(data.occurredAt || data.timestamp),
      failureReason,
      bounceType: data.bounceType || guessBounceType(failureReason),
      smtpResponse: data.smtpResponse || data.response || null,
      payload: ((data.payload ?? body) || null) as Prisma.InputJsonValue,
    });

    return NextResponse.json({
      success: true,
      emailLogId: updated?.id ?? null,
      status: updated?.status ?? null,
      latestEventType: updated?.latestEventType ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process event";
    const status = message === "Email log not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
