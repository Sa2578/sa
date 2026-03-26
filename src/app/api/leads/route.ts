import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");

  const leads = await prisma.lead.findMany({
    where: campaignId
      ? { campaignId, campaign: { userId: session.user.id } }
      : { campaign: { userId: session.user.id, isSystem: false } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(leads);
}
