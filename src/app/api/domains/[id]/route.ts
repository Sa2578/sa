import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { domainSchema } from "@/lib/validators";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const domain = await prisma.domain.findFirst({
    where: { id, userId: session.user.id },
    include: { inboxes: true },
  });

  if (!domain) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const inboxIds = domain.inboxes.map((inbox) => inbox.id);
  if (inboxIds.length > 0) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const counts = await prisma.emailLog.groupBy({
      by: ["inboxId"],
      where: {
        inboxId: { in: inboxIds },
        createdAt: { gte: startOfDay },
      },
      _count: { id: true },
    });

    const countMap = new Map(counts.map((row) => [row.inboxId, row._count.id]));
    domain.inboxes = domain.inboxes.map((inbox) => ({
      ...inbox,
      sentToday: countMap.get(inbox.id) ?? 0,
    }));
  }

  return NextResponse.json(domain);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = domainSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const domain = await prisma.domain.updateMany({
    where: { id, userId: session.user.id },
    data: parsed.data,
  });

  if (domain.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.domain.findFirst({ where: { id, userId: session.user.id } });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await prisma.domain.deleteMany({
    where: { id, userId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
