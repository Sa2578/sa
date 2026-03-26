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

  return NextResponse.json({ metrics, timeSeries, domainMetrics });
}
