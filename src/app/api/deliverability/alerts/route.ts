import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndCreateAlerts } from "@/lib/deliverability";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [domains, inboxes, campaigns] = await Promise.all([
    prisma.domain.findMany({
      where: { userId: session.user.id },
      select: { id: true },
    }),
    prisma.inbox.findMany({
      where: { domain: { userId: session.user.id } },
      select: { id: true },
    }),
    prisma.campaign.findMany({
      where: { userId: session.user.id },
      select: { id: true },
    }),
  ]);

  const domainIds = domains.map((d) => d.id);
  const inboxIds = inboxes.map((i) => i.id);
  const campaignIds = campaigns.map((campaign) => campaign.id);

  const alerts = await prisma.alert.findMany({
    where: {
      resolved: false,
      OR: [
        { entityType: "domain", entityId: { in: domainIds } },
        { entityType: "inbox", entityId: { in: inboxIds } },
        { entityType: "campaign", entityId: { in: campaignIds } },
        {
          entityType: "recipient_provider",
          entityId: { startsWith: `${session.user.id}:` },
        },
        {
          entityType: "sending_host",
          entityId: { startsWith: `${session.user.id}:` },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(alerts);
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await checkAndCreateAlerts({ userId: session.user.id });

  return NextResponse.json({ success: true });
}
