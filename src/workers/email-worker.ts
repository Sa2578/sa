import "dotenv/config";
import { Worker, Job } from "bullmq";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { recordEmailEvent, guessBounceType } from "../lib/email-events";
import { formatMailbox, sendEmail } from "../lib/mailer";
import { getDatabaseUrl } from "../lib/env";
import { selectInboxForSending, syncInboxDailyCounters } from "../lib/inbox-rotation";
import { getRedisConnection } from "../lib/queue";
import { buildTrackingPixelUrl, wrapTrackedLinks } from "../lib/tracking";

const adapter = new PrismaPg({
  connectionString: getDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});
const prisma = new PrismaClient({ adapter });
const connection = getRedisConnection();

interface EmailJob {
  leadId: string;
  campaignId: string;
  userId: string;
}

const worker = new Worker<EmailJob>(
  "email-sending",
  async (job: Job<EmailJob>) => {
    const { leadId, campaignId, userId } = job.data;

    // Get lead and campaign
    const [lead, campaign] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId } }),
      prisma.campaign.findUnique({ where: { id: campaignId } }),
    ]);

    if (!lead || !campaign) {
      throw new Error("Lead or campaign not found");
    }

    // Personalize email
    const subject = campaign.subject
      .replace(/\{\{name\}\}/g, lead.name || "")
      .replace(/\{\{company\}\}/g, lead.company || "")
      .replace(/\{\{email\}\}/g, lead.email);

    const body = campaign.bodyTemplate
      .replace(/\{\{name\}\}/g, lead.name || "")
      .replace(/\{\{company\}\}/g, lead.company || "")
      .replace(/\{\{email\}\}/g, lead.email);

    const { emailLog, selectedInbox } = await prisma.$transaction(async (tx) => {
      const inbox = await selectInboxForSending(tx, userId);
      if (!inbox) {
        throw new Error("No available inbox (all at daily limit)");
      }

      const createdEmailLog = await tx.emailLog.create({
        data: {
          leadId: lead.id,
          inboxId: inbox.id,
          campaignId: campaign.id,
          subject,
          body,
          status: "QUEUED",
        },
      });

      await tx.inbox.update({
        where: { id: inbox.id },
        data: { sentToday: inbox.sentToday + 1 },
      });

      return {
        emailLog: createdEmailLog,
        selectedInbox: inbox,
      };
    });

    try {
      // Add tracking pixel and wrap links for click analytics
      const trackingPixel = `<img src="${buildTrackingPixelUrl(emailLog.id)}" width="1" height="1" style="display:none" />`;
      const htmlWithTracking = wrapTrackedLinks(body, emailLog.id) + trackingPixel;
      const textBody = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      // Send email
      const result = await sendEmail(
        {
          smtpHost: selectedInbox.smtpHost,
          smtpPort: selectedInbox.smtpPort,
          smtpUser: selectedInbox.smtpUser,
          smtpPass: selectedInbox.smtpPass,
        },
        {
          from: formatMailbox(selectedInbox.emailAddress, selectedInbox.senderName),
          to: lead.email,
          subject,
          html: htmlWithTracking,
          text: textBody,
          replyTo: selectedInbox.replyToEmail || undefined,
          headers: {
            "X-OutboundCRM-Log-Id": emailLog.id,
            "X-OutboundCRM-Campaign-Id": campaign.id,
          },
        }
      );

      const sentAt = new Date();

      await Promise.all([
        recordEmailEvent({
          logId: emailLog.id,
          eventType: "accepted",
          source: "smtp",
          occurredAt: sentAt,
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
        prisma.lead.update({
          where: { id: lead.id },
          data: { status: "CONTACTED" },
        }),
      ]);

      console.log(`Sent email to ${lead.email} via ${selectedInbox.emailAddress}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isBounce = message.includes("550") || /bounce/i.test(message);

      await recordEmailEvent({
        logId: emailLog.id,
        eventType: isBounce ? "bounce" : "failed",
        source: "smtp",
        occurredAt: new Date(),
        failureReason: message,
        bounceType: isBounce ? guessBounceType(message) : null,
        payload: {
          error: message,
        } as Prisma.InputJsonValue,
      });

      await prisma.$transaction(async (tx) => {
        await syncInboxDailyCounters(tx, [selectedInbox.id]);
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

console.log("Email worker started, waiting for jobs...");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
