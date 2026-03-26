import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEmailQueue } from "@/lib/queue";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: session.user.id, isSystem: false },
    include: { leads: { where: { status: "NEW" } } },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (campaign.status === "ACTIVE") {
    return NextResponse.json({ error: "Campaign already active" }, { status: 400 });
  }

  if (campaign.leads.length === 0) {
    return NextResponse.json({ error: "No leads to send to" }, { status: 400 });
  }

  try {
    const queue = getEmailQueue();
    await queue.addBulk(
      campaign.leads.map((lead, index) => ({
        name: "send-email",
        data: {
          leadId: lead.id,
          campaignId: campaign.id,
          userId: session.user.id,
        },
        opts: {
          delay: index * 5000,
          attempts: 3,
          backoff: { type: "exponential", delay: 30000 },
          removeOnComplete: 1000,
          removeOnFail: 500,
        },
      }))
    );

    await prisma.campaign.update({
      where: { id },
      data: { status: "ACTIVE" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue unavailable";
    return NextResponse.json(
      { error: `Unable to enqueue campaign: ${message}` },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    queued: campaign.leads.length,
  });
}
