import { NextResponse } from "next/server";
import { z } from "zod";
import type { EmailStatus, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { analyzeRawHeaders } from "@/lib/header-analysis";
import { prisma } from "@/lib/prisma";

const headerSchema = z.object({
  rawHeaders: z.string().trim().min(1),
  emailLogId: z.string().trim().min(1).optional(),
  placement: z
    .enum(["INBOX", "PROMOTIONS", "SPAM", "UPDATES", "FORUMS", "OTHER", "UNKNOWN"])
    .optional(),
});

function shouldPromoteToDelivered(status: EmailStatus) {
  return status === "QUEUED" || status === "SENT" || status === "FAILED";
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = headerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const analysis = analyzeRawHeaders(parsed.data.rawHeaders);

    let emailLog = null;

    if (parsed.data.emailLogId) {
      emailLog = await prisma.emailLog.findFirst({
        where: {
          id: parsed.data.emailLogId,
          inbox: { domain: { userId: session.user.id } },
        },
        select: {
          id: true,
          status: true,
          latestEventType: true,
          lastEventAt: true,
          deliveredAt: true,
          spamAt: true,
          messageId: true,
          providerMessageId: true,
          inbox: {
            select: {
              emailAddress: true,
            },
          },
        },
      });
    }

    if (!emailLog && analysis.messageId) {
      emailLog = await prisma.emailLog.findFirst({
        where: {
          inbox: { domain: { userId: session.user.id } },
          OR: [
            { messageId: analysis.messageId },
            { providerMessageId: analysis.messageId },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          latestEventType: true,
          lastEventAt: true,
          deliveredAt: true,
          spamAt: true,
          messageId: true,
          providerMessageId: true,
          inbox: {
            select: {
              emailAddress: true,
            },
          },
        },
      });
    }

    if (!emailLog) {
      return NextResponse.json({
        analysis,
        persisted: false,
        matchedLog: false,
      });
    }

    const occurredAt = new Date();
    const placement = parsed.data.placement ?? "UNKNOWN";
    const payload = {
      kind: "gmail_header_analysis",
      placement,
      analysis: analysis as unknown as Prisma.InputJsonValue,
    } as Prisma.InputJsonObject;

    const emailLogData: Prisma.EmailLogUpdateInput = {
      messageId: analysis.messageId ?? emailLog.messageId,
      providerMessageId: analysis.messageId ?? emailLog.providerMessageId,
    };

    if (placement === "SPAM") {
      emailLogData.status = "SPAM";
      emailLogData.spamAt = emailLog.spamAt ?? occurredAt;
      emailLogData.latestEventType = "spam";
      emailLogData.lastEventAt = occurredAt;
    } else {
      emailLogData.deliveredAt = emailLog.deliveredAt ?? occurredAt;

      if (shouldPromoteToDelivered(emailLog.status)) {
        emailLogData.status = "DELIVERED";
        emailLogData.latestEventType = "delivered";
        emailLogData.lastEventAt = occurredAt;
      }
    }

    await prisma.$transaction([
      prisma.emailLog.update({
        where: { id: emailLog.id },
        data: emailLogData,
      }),
      prisma.emailEvent.create({
        data: {
          emailLogId: emailLog.id,
          eventType: "header_analysis",
          source: "manual",
          occurredAt,
          messageId: analysis.messageId ?? emailLog.messageId,
          providerMessageId: analysis.messageId ?? emailLog.providerMessageId,
          payload,
        },
      }),
    ]);

    return NextResponse.json({
      analysis,
      persisted: true,
      matchedLog: true,
      placement,
      emailLogId: emailLog.id,
      inboxEmailAddress: emailLog.inbox.emailAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze headers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
