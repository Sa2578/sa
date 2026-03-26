import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const inbox = await prisma.inbox.findFirst({
    where: { id, domain: { userId: session.user.id } },
    select: { id: true },
  });

  if (!inbox) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const requestedTake = parseInt(searchParams.get("take") || "25", 10);
  const take = Number.isNaN(requestedTake) ? 25 : Math.min(Math.max(requestedTake, 1), 100);

  const logs = await prisma.emailLog.findMany({
    where: { inboxId: inbox.id },
    include: {
      lead: { select: { email: true, name: true, status: true } },
      campaign: { select: { id: true, name: true, isSystem: true } },
      events: { orderBy: { receivedAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json(logs);
}
