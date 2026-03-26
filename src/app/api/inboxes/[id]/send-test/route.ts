import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getAppUrlDiagnostics } from "@/lib/env";
import { recordEmailEvent, guessBounceType } from "@/lib/email-events";
import { formatMailbox, sendEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { buildTrackingPixelUrl, wrapTrackedLinks } from "@/lib/tracking";

const sendTestSchema = z.object({
  recipientEmail: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(1).max(255).optional(),
  bodyHtml: z.string().trim().min(1).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = sendTestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const inbox = await prisma.inbox.findFirst({
      where: { id, domain: { userId: session.user.id } },
      include: { domain: true },
    });

    if (!inbox) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }

    const appUrl = getAppUrlDiagnostics();
    const systemCampaignName = "__Deliverability Tests__";

    let campaign = await prisma.campaign.findFirst({
      where: {
        userId: session.user.id,
        isSystem: true,
        name: systemCampaignName,
      },
    });

    if (!campaign) {
      campaign = await prisma.campaign.create({
        data: {
          userId: session.user.id,
          isSystem: true,
          name: systemCampaignName,
          subject: "[Deliverability Test] {{email}}",
          bodyTemplate: "<p>This is a system deliverability test.</p>",
          status: "ACTIVE",
        },
      });
    }

    const subject =
      parsed.data.subject ||
      `[Deliverability Test] ${inbox.emailAddress} -> ${parsed.data.recipientEmail}`;

    const htmlBody =
      parsed.data.bodyHtml ||
      `
        <p>Hello,</p>
        <p>This is a real deliverability test sent from <strong>${inbox.emailAddress}</strong>.</p>
        <p>If you can see this message, the SMTP handoff worked.</p>
        <p>Please open it from Gmail and, if you want, click <a href="https://example.com">this test link</a>.</p>
        <p>Regards,<br/>Outbound CRM</p>
      `.trim();

    const lead = await prisma.lead.upsert({
      where: {
        email_campaignId: {
          email: parsed.data.recipientEmail,
          campaignId: campaign.id,
        },
      },
      update: {
        status: "NEW",
        name: parsed.data.recipientEmail.split("@")[0],
      },
      create: {
        email: parsed.data.recipientEmail,
        name: parsed.data.recipientEmail.split("@")[0],
        company: "Deliverability Test",
        status: "NEW",
        campaignId: campaign.id,
      },
    });

    const emailLog = await prisma.emailLog.create({
      data: {
        leadId: lead.id,
        inboxId: inbox.id,
        campaignId: campaign.id,
        subject,
        body: htmlBody,
        status: "QUEUED",
      },
    });

    const trackingPixel = `<img src="${buildTrackingPixelUrl(emailLog.id)}" width="1" height="1" style="display:none" alt="" />`;
    const htmlWithTracking = wrapTrackedLinks(htmlBody, emailLog.id) + trackingPixel;
    const textBody = htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    try {
      const result = await sendEmail(
        {
          smtpHost: inbox.smtpHost,
          smtpPort: inbox.smtpPort,
          smtpUser: inbox.smtpUser,
          smtpPass: inbox.smtpPass,
        },
        {
          from: formatMailbox(inbox.emailAddress, inbox.senderName),
          to: parsed.data.recipientEmail,
          subject,
          html: htmlWithTracking,
          text: textBody,
          replyTo: inbox.replyToEmail || undefined,
          headers: {
            "X-OutboundCRM-Log-Id": emailLog.id,
            "X-OutboundCRM-Campaign-Id": campaign.id,
          },
        }
      );

      await Promise.all([
        recordEmailEvent({
          logId: emailLog.id,
          eventType: "accepted",
          source: "smtp",
          occurredAt: new Date(),
          messageId: result.messageId,
          payload: {
            accepted: result.accepted.map(String),
            rejected: result.rejected.map(String),
            response: result.response,
            envelope: {
              from: result.envelope.from ? String(result.envelope.from) : null,
              to: result.envelope.to.map(String),
            },
          } as Prisma.InputJsonValue,
        }),
        prisma.emailLog.update({
          where: { id: emailLog.id },
          data: {
            smtpResponse: result.response,
            providerMessageId: result.messageId,
          },
        }),
        prisma.inbox.update({
          where: { id: inbox.id },
          data: {
            smtpLastError: null,
          },
        }),
        prisma.lead.update({
          where: { id: lead.id },
          data: { status: "CONTACTED" },
        }),
      ]);

      return NextResponse.json({
        success: true,
        emailLogId: emailLog.id,
        messageId: result.messageId,
        tracking: {
          appUrl: appUrl.url,
          isPublic: appUrl.isPublic,
          isHttps: appUrl.isHttps,
          warning:
            appUrl.isPublic && appUrl.isHttps
              ? null
              : "Tracking pixel and click analytics need a public HTTPS NEXTAUTH_URL to work with a real mailbox.",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error";

      await recordEmailEvent({
        logId: emailLog.id,
        eventType: /bounce|550/i.test(message) ? "bounce" : "failed",
        source: "smtp",
        occurredAt: new Date(),
        failureReason: message,
        bounceType: guessBounceType(message),
        payload: {
          error: message,
        } as Prisma.InputJsonValue,
      });

      await prisma.inbox.update({
        where: { id: inbox.id },
        data: {
          smtpLastError: message,
        },
      });

      return NextResponse.json(
        {
          error: message,
          emailLogId: emailLog.id,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send test email";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
