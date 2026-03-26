import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndCreateAlerts } from "@/lib/deliverability";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await checkAndCreateAlerts({ userId: session.user.id });

  // Get alerts for user's domains/inboxes
  const domains = await prisma.domain.findMany({
    where: { userId: session.user.id },
    select: { id: true },
  });
  const inboxes = await prisma.inbox.findMany({
    where: { domain: { userId: session.user.id } },
    select: { id: true },
  });

  const domainIds = domains.map((d) => d.id);
  const inboxIds = inboxes.map((i) => i.id);

  const alerts = await prisma.alert.findMany({
    where: {
      resolved: false,
      OR: [
        { entityType: "domain", entityId: { in: domainIds } },
        { entityType: "inbox", entityId: { in: inboxIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(alerts);
}
