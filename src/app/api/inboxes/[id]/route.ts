import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inboxSchema } from "@/lib/validators";
import { syncInboxDailyCounters } from "@/lib/inbox-rotation";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const inbox = await prisma.inbox.findFirst({
    where: { id, domain: { userId: session.user.id } },
    include: { domain: true },
  });

  if (!inbox) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await syncInboxDailyCounters(prisma, [inbox.id]);

  const refreshed = await prisma.inbox.findFirst({
    where: { id, domain: { userId: session.user.id } },
    include: { domain: true },
  });

  return NextResponse.json(refreshed);
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
  const parsed = inboxSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  // Verify ownership
  const existing = await prisma.inbox.findFirst({
    where: { id, domain: { userId: session.user.id } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.inbox.update({
    where: { id },
    data: parsed.data,
  });

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
  const existing = await prisma.inbox.findFirst({
    where: { id, domain: { userId: session.user.id } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.inbox.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
