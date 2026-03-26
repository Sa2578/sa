import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySmtp } from "@/lib/mailer";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let inboxId: string | null = null;

  try {
    const body = await req.json();
    inboxId = typeof body?.inboxId === "string" ? body.inboxId : null;
    if (!inboxId) {
      return NextResponse.json({ error: "Inbox ID required" }, { status: 400 });
    }

    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, domain: { userId: session.user.id } },
      select: {
        id: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPass: true,
        emailAddress: true,
      },
    });

    if (!inbox) {
      return NextResponse.json({ error: "Inbox not found" }, { status: 404 });
    }

    await verifySmtp(inbox);

    await prisma.inbox.update({
      where: { id: inbox.id },
      data: {
        lastSmtpVerifiedAt: new Date(),
        smtpLastError: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `SMTP connection verified for ${inbox.emailAddress}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP verification failed";
    if (inboxId) {
      await prisma.inbox.updateMany({
        where: { id: inboxId, domain: { userId: session.user.id } },
        data: {
          smtpLastError: message,
        },
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
