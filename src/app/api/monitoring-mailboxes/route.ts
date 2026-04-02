import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptMonitoringMailboxCredentials,
  monitoringMailboxSchema,
  normalizeMonitoringMailboxInput,
  serializeMonitoringMailbox,
} from "@/lib/monitoring-mailboxes";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mailboxes = await prisma.monitoringMailbox.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      usage: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      inboxFolderHint: true,
      spamFolderHint: true,
      notes: true,
      isActive: true,
      lastCheckedAt: true,
      lastCheckError: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(mailboxes.map(serializeMonitoringMailbox));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = monitoringMailboxSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const normalized = normalizeMonitoringMailboxInput(parsed.data);

  const mailbox = await prisma.monitoringMailbox.create({
    data: {
      userId: session.user.id,
      emailAddress: parsed.data.emailAddress,
      provider: normalized.provider || "custom",
      usage: parsed.data.usage,
      imapHost: normalized.imapHost || null,
      imapPort: normalized.imapPort,
      imapSecure: normalized.imapSecure,
      ...encryptMonitoringMailboxCredentials({
        imapUser: parsed.data.imapUser,
        imapPass: parsed.data.imapPass,
      }),
      inboxFolderHint: normalized.inboxFolderHint,
      spamFolderHint: normalized.spamFolderHint,
      notes: normalized.notes,
      isActive: normalized.isActive,
    },
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      usage: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      inboxFolderHint: true,
      spamFolderHint: true,
      notes: true,
      isActive: true,
      lastCheckedAt: true,
      lastCheckError: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(serializeMonitoringMailbox(mailbox), { status: 201 });
}
