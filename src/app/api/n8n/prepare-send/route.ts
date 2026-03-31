import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildTrackingPixelUrl, wrapTrackedLinks } from "@/lib/tracking";
import { getAppUrl } from "@/lib/env";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

const prepareSendSchema = z
  .object({
    inboxId: z.string().trim().min(1).optional(),
    inboxEmailAddress: z.string().trim().toLowerCase().email().optional(),
    recipientEmail: z.string().trim().toLowerCase().email(),
    recipientName: z.string().trim().min(1).max(255).optional(),
    recipientCompany: z.string().trim().min(1).max(255).optional(),
    subject: z.string().trim().min(1).max(500),
    bodyHtml: z.string().trim().min(1),
    bodyText: z.string().trim().min(1).optional(),
    campaignId: z.string().trim().min(1).optional(),
    campaignName: z.string().trim().min(1).max(255).optional(),
    workflowName: z.string().trim().min(1).max(255).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine((data) => Boolean(data.inboxId || data.inboxEmailAddress), {
    message: "Inbox ID or inbox email address is required",
    path: ["inboxId"],
  });

function htmlToText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function resolveCampaign(input: z.infer<typeof prepareSendSchema>, userId: string) {
  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, userId },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    return campaign;
  }

  const defaultName =
    input.campaignName ||
    (input.workflowName ? `__n8n__ ${input.workflowName}` : "__n8n__ External Sends");

  const existing = await prisma.campaign.findFirst({
    where: {
      userId,
      isSystem: true,
      name: defaultName,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.campaign.create({
    data: {
      userId,
      isSystem: true,
      name: defaultName,
      subject: input.subject,
      bodyTemplate: input.bodyHtml,
      status: "ACTIVE",
    },
  });
}

export async function POST(req: Request) {
  try {
    if (!isWebhookAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = prepareSendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const inbox = await prisma.inbox.findFirst({
      where: parsed.data.inboxId
        ? { id: parsed.data.inboxId }
        : { emailAddress: parsed.data.inboxEmailAddress },
      include: {
        domain: {
          select: {
            userId: true,
            domainName: true,
          },
        },
      },
    });

    if (!inbox) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }

    const campaign = await resolveCampaign(parsed.data, inbox.domain.userId);

    const lead = await prisma.lead.upsert({
      where: {
        email_campaignId: {
          email: parsed.data.recipientEmail,
          campaignId: campaign.id,
        },
      },
      update: {
        status: "NEW",
        name: parsed.data.recipientName,
        company: parsed.data.recipientCompany,
      },
      create: {
        email: parsed.data.recipientEmail,
        name: parsed.data.recipientName,
        company: parsed.data.recipientCompany,
        status: "NEW",
        campaignId: campaign.id,
      },
    });

    const emailLog = await prisma.emailLog.create({
      data: {
        leadId: lead.id,
        inboxId: inbox.id,
        campaignId: campaign.id,
        subject: parsed.data.subject,
        body: parsed.data.bodyHtml,
        status: "QUEUED",
      },
    });

    if (parsed.data.metadata) {
      await prisma.emailEvent.create({
        data: {
          emailLogId: emailLog.id,
          eventType: "prepared",
          source: "manual",
          payload: {
            kind: "n8n_prepare_send",
            metadata: parsed.data.metadata,
          },
        },
      });
    }

    const trackedHtml =
      wrapTrackedLinks(parsed.data.bodyHtml, emailLog.id) +
      `<img src="${buildTrackingPixelUrl(emailLog.id)}" width="1" height="1" style="display:none" alt="" />`;

    const textBody = parsed.data.bodyText || htmlToText(parsed.data.bodyHtml);
    const baseUrl = getAppUrl().replace(/\/$/, "");

    return NextResponse.json({
      success: true,
      preparedAt: new Date().toISOString(),
      userId: inbox.domain.userId,
      inbox: {
        id: inbox.id,
        emailAddress: inbox.emailAddress,
        senderName: inbox.senderName,
        replyToEmail: inbox.replyToEmail,
        domainName: inbox.domain.domainName,
      },
      campaign: {
        id: campaign.id,
        name: campaign.name,
        isSystem: campaign.isSystem,
      },
      lead: {
        id: lead.id,
        email: lead.email,
        name: lead.name,
        company: lead.company,
      },
      emailLog: {
        id: emailLog.id,
        subject: emailLog.subject,
        status: emailLog.status,
      },
      message: {
        subject: parsed.data.subject,
        html: trackedHtml,
        text: textBody,
        headers: {
          "X-OutboundCRM-Log-Id": emailLog.id,
          "X-OutboundCRM-Campaign-Id": campaign.id,
          "X-OutboundCRM-Inbox-Id": inbox.id,
        },
      },
      providerHints: {
        metadata: {
          outboundcrm_log_id: emailLog.id,
          outboundcrm_campaign_id: campaign.id,
          outboundcrm_inbox_id: inbox.id,
        },
        sendgrid: {
          customArgs: {
            outboundcrm_log_id: emailLog.id,
            outboundcrm_campaign_id: campaign.id,
            outboundcrm_inbox_id: inbox.id,
          },
        },
        mailgun: {
          variables: {
            outboundcrm_log_id: emailLog.id,
            outboundcrm_campaign_id: campaign.id,
            outboundcrm_inbox_id: inbox.id,
          },
        },
        postmark: {
          metadata: {
            outboundcrm_log_id: emailLog.id,
            outboundcrm_campaign_id: campaign.id,
            outboundcrm_inbox_id: inbox.id,
          },
        },
        resend: {
          tags: [
            { name: "outboundcrm_log_id", value: emailLog.id },
            { name: "outboundcrm_campaign_id", value: campaign.id },
            { name: "outboundcrm_inbox_id", value: inbox.id },
          ],
        },
        ses: {
          emailTags: [
            { Name: "outboundcrm_log_id", Value: emailLog.id },
            { Name: "outboundcrm_campaign_id", Value: campaign.id },
            { Name: "outboundcrm_inbox_id", Value: inbox.id },
          ],
        },
      },
      tracking: {
        openPixelUrl: buildTrackingPixelUrl(emailLog.id),
        eventsWebhookUrl: `${baseUrl}/api/n8n/events`,
        headersWebhookUrl: `${baseUrl}/api/n8n/header-analysis`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare tracked email";
    const status = message === "Campaign not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
