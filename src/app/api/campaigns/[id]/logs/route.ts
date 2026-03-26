import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify campaign ownership
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: session.user.id, isSystem: false },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const logs = await prisma.emailLog.findMany({
    where: { campaignId: id },
    include: {
      lead: { select: { email: true, name: true } },
      inbox: { select: { emailAddress: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(logs);
}
