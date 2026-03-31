import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndCreateAlerts, getMetrics, getMetricsOverTime } from "@/lib/deliverability";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get("domainId") || undefined;
  const inboxId = searchParams.get("inboxId") || undefined;
  const days = parseInt(searchParams.get("days") || "30");

  // Verify ownership if filtering
  if (domainId) {
    const domain = await prisma.domain.findFirst({
      where: { id: domainId, userId: session.user.id },
    });
    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }
  }
  if (inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, domain: { userId: session.user.id } },
    });
    if (!inbox) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }
  }

  await checkAndCreateAlerts({ userId: session.user.id });

  const [metrics, timeSeries] = await Promise.all([
    getMetrics({ userId: session.user.id, domainId, inboxId, days }),
    getMetricsOverTime({ userId: session.user.id, domainId, inboxId, days }),
  ]);

  // Get per-domain breakdown
  const domains = await prisma.domain.findMany({
    where: { userId: session.user.id },
    select: { id: true, domainName: true },
  });

  const domainMetrics = await Promise.all(
    domains.map(async (d) => ({
      ...d,
      metrics: await getMetrics({ userId: session.user.id, domainId: d.id, days }),
    }))
  );

  const [inboxes, campaigns] = await Promise.all([
    prisma.inbox.findMany({
      where: { domain: { userId: session.user.id } },
      select: { id: true, emailAddress: true },
    }),
    prisma.campaign.findMany({
      where: {
        userId: session.user.id,
        emailLogs: {
          some: {
            sentAt: {
              gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
      select: { id: true, name: true, isSystem: true },
    }),
  ]);

  const [inboxMetrics, campaignMetrics] = await Promise.all([
    Promise.all(
      inboxes.map(async (inbox) => ({
        ...inbox,
        metrics: await getMetrics({ userId: session.user.id, inboxId: inbox.id, days }),
      }))
    ),
    Promise.all(
      campaigns.map(async (campaign) => ({
        ...campaign,
        metrics: await getMetrics({ userId: session.user.id, campaignId: campaign.id, days }),
      }))
    ),
  ]);

  return NextResponse.json({ metrics, timeSeries, domainMetrics, inboxMetrics, campaignMetrics });
}
