import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publicInboxWithDomainSelect } from "@/lib/inbox-response";
import { encryptInboxCredentials } from "@/lib/smtp-credentials";
import { inboxSchema } from "@/lib/validators";
import { syncInboxDailyCounters } from "@/lib/inbox-rotation";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inboxes = await prisma.inbox.findMany({
    where: { domain: { userId: session.user.id } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  await syncInboxDailyCounters(prisma, inboxes.map((inbox) => inbox.id));

  const refreshed = await prisma.inbox.findMany({
    where: { domain: { userId: session.user.id } },
    select: publicInboxWithDomainSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(refreshed);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = inboxSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    // Verify domain ownership
    const domain = await prisma.domain.findFirst({
      where: { id: parsed.data.domainId, userId: session.user.id },
    });
    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const inbox = await prisma.inbox.create({
      data: encryptInboxCredentials(parsed.data),
      select: publicInboxWithDomainSelect,
    });
    return NextResponse.json(inbox, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "Inbox already exists"
        : "Internal server error";

    return NextResponse.json({ error: message }, { status: message === "Internal server error" ? 500 : 409 });
  }
}
