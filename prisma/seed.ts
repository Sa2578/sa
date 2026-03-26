import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Create demo user
  const passwordHash = await hash("password123", 12);
  const user = await prisma.user.upsert({
    where: { email: "demo@outboundcrm.com" },
    update: {},
    create: {
      email: "demo@outboundcrm.com",
      name: "Demo User",
      passwordHash,
    },
  });

  console.log(`Created user: ${user.email}`);

  // Create domains
  const domain1 = await prisma.domain.upsert({
    where: { domainName: "outreach.io" },
    update: {},
    create: {
      domainName: "outreach.io",
      status: "ACTIVE",
      spfValid: true,
      dkimValid: true,
      dmarcValid: true,
      userId: user.id,
    },
  });

  const domain2 = await prisma.domain.upsert({
    where: { domainName: "coldmail.co" },
    update: {},
    create: {
      domainName: "coldmail.co",
      status: "WARMUP",
      spfValid: true,
      dkimValid: false,
      dmarcValid: true,
      userId: user.id,
    },
  });

  console.log("Created domains");

  // Create inboxes
  const inbox1 = await prisma.inbox.upsert({
    where: { emailAddress: "john@outreach.io" },
    update: {},
    create: {
      emailAddress: "john@outreach.io",
      domainId: domain1.id,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "john@outreach.io",
      smtpPass: "app-password-here",
      dailyLimit: 50,
      sentToday: 23,
      reputationScore: 92,
      warmupStatus: "COMPLETED",
    },
  });

  const inbox2 = await prisma.inbox.upsert({
    where: { emailAddress: "sarah@outreach.io" },
    update: {},
    create: {
      emailAddress: "sarah@outreach.io",
      domainId: domain1.id,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "sarah@outreach.io",
      smtpPass: "app-password-here",
      dailyLimit: 40,
      sentToday: 15,
      reputationScore: 88,
      warmupStatus: "COMPLETED",
    },
  });

  const inbox3 = await prisma.inbox.upsert({
    where: { emailAddress: "hello@coldmail.co" },
    update: {},
    create: {
      emailAddress: "hello@coldmail.co",
      domainId: domain2.id,
      smtpHost: "smtp.zoho.com",
      smtpPort: 587,
      smtpUser: "hello@coldmail.co",
      smtpPass: "app-password-here",
      dailyLimit: 20,
      sentToday: 5,
      reputationScore: 75,
      warmupStatus: "IN_PROGRESS",
    },
  });

  console.log("Created inboxes");

  // Create campaign
  const campaign = await prisma.campaign.upsert({
    where: { id: "seed-campaign-1" },
    update: {},
    create: {
      id: "seed-campaign-1",
      name: "Q1 SaaS Outreach",
      subject: "Quick question about {{company}}",
      bodyTemplate: "<p>Hi {{name}},</p><p>I came across {{company}} and noticed you might benefit from our deliverability tools.</p><p>Would you be open to a quick 15-min chat this week?</p><p>Best,<br>John</p>",
      status: "ACTIVE",
      userId: user.id,
    },
  });

  console.log("Created campaign");

  // Create leads
  const leadEmails = [
    { email: "alice@techcorp.com", name: "Alice Johnson", company: "TechCorp" },
    { email: "bob@startup.io", name: "Bob Smith", company: "StartupIO" },
    { email: "carol@bigco.com", name: "Carol Williams", company: "BigCo" },
    { email: "dave@saas.dev", name: "Dave Brown", company: "SaaS Dev" },
    { email: "emma@agency.co", name: "Emma Davis", company: "Agency Co" },
    { email: "frank@venture.io", name: "Frank Miller", company: "Venture IO" },
    { email: "grace@digital.com", name: "Grace Wilson", company: "Digital Inc" },
    { email: "henry@growth.co", name: "Henry Taylor", company: "Growth Co" },
  ];

  for (const lead of leadEmails) {
    await prisma.lead.upsert({
      where: { email_campaignId: { email: lead.email, campaignId: campaign.id } },
      update: {},
      create: { ...lead, campaignId: campaign.id, status: "CONTACTED" },
    });
  }

  console.log("Created leads");

  // Create email logs with varied statuses for deliverability data
  const statuses: Array<{ status: "SENT" | "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "SPAM"; weight: number }> = [
    { status: "SENT", weight: 20 },
    { status: "DELIVERED", weight: 30 },
    { status: "OPENED", weight: 25 },
    { status: "CLICKED", weight: 10 },
    { status: "BOUNCED", weight: 8 },
    { status: "SPAM", weight: 2 },
  ];

  const inboxes = [inbox1, inbox2, inbox3];
  const leads = await prisma.lead.findMany({ where: { campaignId: campaign.id } });

  // Generate 30 days of email logs
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const date = new Date();
    date.setDate(date.getDate() - dayOffset);

    const emailsPerDay = 5 + Math.floor(Math.random() * 10);

    for (let i = 0; i < emailsPerDay; i++) {
      const lead = leads[Math.floor(Math.random() * leads.length)];
      const inbox = inboxes[Math.floor(Math.random() * inboxes.length)];

      // Weighted random status
      const totalWeight = statuses.reduce((sum, s) => sum + s.weight, 0);
      let random = Math.random() * totalWeight;
      let selectedStatus = statuses[0].status;
      for (const s of statuses) {
        random -= s.weight;
        if (random <= 0) {
          selectedStatus = s.status;
          break;
        }
      }

      const sentAt = new Date(date);
      sentAt.setHours(9 + Math.floor(Math.random() * 8));
      sentAt.setMinutes(Math.floor(Math.random() * 60));

      await prisma.emailLog.create({
        data: {
          leadId: lead.id,
          inboxId: inbox.id,
          campaignId: campaign.id,
          subject: `Quick question about ${lead.company || "your company"}`,
          body: "<p>Email body here</p>",
          status: selectedStatus,
          sentAt,
          openedAt: ["OPENED", "CLICKED"].includes(selectedStatus) ? new Date(sentAt.getTime() + 3600000) : null,
          clickedAt: selectedStatus === "CLICKED" ? new Date(sentAt.getTime() + 7200000) : null,
          bouncedAt: selectedStatus === "BOUNCED" ? sentAt : null,
        },
      });
    }
  }

  console.log("Created email logs (30 days of data)");

  // Create sample alerts
  await prisma.alert.createMany({
    data: [
      {
        type: "HIGH_BOUNCE",
        severity: "warning",
        message: "Inbox hello@coldmail.co has elevated bounce rate (12%)",
        entityType: "inbox",
        entityId: inbox3.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log("Created alerts");
  console.log("Seed completed!");
  console.log("\nLogin credentials:");
  console.log("  Email: demo@outboundcrm.com");
  console.log("  Password: password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
