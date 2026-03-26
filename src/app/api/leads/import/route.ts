import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseLeadsCsv } from "@/lib/csv-parser";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const campaignId = formData.get("campaignId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!campaignId) {
      return NextResponse.json({ error: "Campaign ID required" }, { status: 400 });
    }

    // Verify campaign ownership
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, userId: session.user.id },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const csvText = await file.text();
    const { leads, errors } = parseLeadsCsv(csvText);

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No valid leads found", parseErrors: errors },
        { status: 400 }
      );
    }

    const result = await prisma.lead.createMany({
      data: leads.map((l) => ({ ...l, campaignId })),
      skipDuplicates: true,
    });

    return NextResponse.json({
      imported: result.count,
      total: leads.length,
      skipped: leads.length - result.count,
      parseErrors: errors,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
