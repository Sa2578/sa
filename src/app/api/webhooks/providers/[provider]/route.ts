import { NextResponse } from "next/server";
import { recordEmailEvent } from "@/lib/email-events";
import {
  normalizeProviderWebhook,
  parseWebhookRequestBody,
  supportedWebhookProviders,
  type SupportedWebhookProvider,
} from "@/lib/provider-webhooks";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

function isSupportedProvider(value: string): value is SupportedWebhookProvider {
  return supportedWebhookProviders.includes(value as SupportedWebhookProvider);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    if (!isWebhookAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    const { provider } = await params;
    if (!isSupportedProvider(provider)) {
      return NextResponse.json({ error: "Unsupported provider" }, { status: 404 });
    }

    const payload = await parseWebhookRequestBody(req);
    const normalized = normalizeProviderWebhook(provider, payload);

    if (normalized.events.length === 0) {
      return NextResponse.json(
        {
          success: false,
          provider,
          receivedEvents: normalized.receivedEvents,
          ignoredEvents: normalized.ignoredEvents,
          error: "No supported events found in payload",
        },
        { status: 400 }
      );
    }

    const recorded = [];
    const failed = [];

    for (const event of normalized.events) {
      try {
        const updated = await recordEmailEvent({
          logId: event.logId,
          messageId: event.messageId,
          providerMessageId: event.providerMessageId,
          eventType: event.eventType,
          source: "webhook",
          occurredAt: event.occurredAt,
          failureReason: event.failureReason,
          bounceType: event.bounceType,
          smtpResponse: event.smtpResponse,
          payload: event.payload,
        });

        recorded.push({
          providerEvent: event.providerEvent,
          eventType: event.eventType,
          emailLogId: updated?.id ?? null,
          latestEventType: updated?.latestEventType ?? null,
          status: updated?.status ?? null,
        });
      } catch (error) {
        failed.push({
          providerEvent: event.providerEvent,
          eventType: event.eventType,
          logId: event.logId ?? null,
          messageId: event.messageId ?? null,
          providerMessageId: event.providerMessageId ?? null,
          error: error instanceof Error ? error.message : "Unable to record provider event",
        });
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      provider,
      receivedEvents: normalized.receivedEvents,
      ignoredEvents: normalized.ignoredEvents,
      recordedEvents: recorded.length,
      failedEvents: failed.length,
      recorded,
      failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process provider webhook";
    const status = message === "Unsupported webhook payload" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
