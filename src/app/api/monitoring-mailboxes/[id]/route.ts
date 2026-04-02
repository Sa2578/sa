import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptMonitoringMailboxCredentials,
  monitoringMailboxUpdateSchema,
  normalizeMonitoringMailboxInput,
  serializeMonitoringMailbox,
} from "@/lib/monitoring-mailboxes";

async function loadOwnedMailbox(userId: string, id: string) {
  return prisma.monitoringMailbox.findFirst({
    where: {
      id,
      userId,
    },
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      usage: true,
      imapHost: true,
      imapPort: true,
      imapSecure: true,
      imapUser: true,
      imapPass: true,
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
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await loadOwnedMailbox(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Monitoring mailbox not found" }, { status: 404 });
  }

  const parsed = monitoringMailboxUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const merged = normalizeMonitoringMailboxInput({
    emailAddress: parsed.data.emailAddress ?? existing.emailAddress,
    provider: parsed.data.provider ?? existing.provider,
    usage: parsed.data.usage ?? existing.usage,
    imapHost: parsed.data.imapHost ?? existing.imapHost ?? undefined,
    imapPort: parsed.data.imapPort ?? existing.imapPort,
    imapSecure: parsed.data.imapSecure ?? existing.imapSecure,
    imapUser: parsed.data.imapUser ?? existing.imapUser,
    imapPass: parsed.data.imapPass ?? existing.imapPass,
    inboxFolderHint: parsed.data.inboxFolderHint ?? existing.inboxFolderHint ?? undefined,
    spamFolderHint: parsed.data.spamFolderHint ?? existing.spamFolderHint ?? undefined,
    notes: parsed.data.notes ?? existing.notes ?? undefined,
    isActive: parsed.data.isActive ?? existing.isActive,
  });

  const data: Record<string, unknown> = {
    emailAddress: merged.emailAddress,
    provider: merged.provider || "custom",
    usage: merged.usage,
    imapHost: merged.imapHost || null,
    imapPort: merged.imapPort,
    imapSecure: merged.imapSecure,
    inboxFolderHint: merged.inboxFolderHint,
    spamFolderHint: merged.spamFolderHint,
    notes: merged.notes,
    isActive: merged.isActive,
  };

  if (typeof parsed.data.imapUser === "string" || typeof parsed.data.imapPass === "string") {
    Object.assign(
      data,
      encryptMonitoringMailboxCredentials({
        imapUser: typeof parsed.data.imapUser === "string" ? parsed.data.imapUser : existing.imapUser,
        imapPass: typeof parsed.data.imapPass === "string" ? parsed.data.imapPass : existing.imapPass,
      })
    );
  }

  const mailbox = await prisma.monitoringMailbox.update({
    where: { id: existing.id },
    data,
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

  return NextResponse.json(serializeMonitoringMailbox(mailbox));
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
  const existing = await loadOwnedMailbox(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Monitoring mailbox not found" }, { status: 404 });
  }

  await prisma.monitoringMailbox.delete({
    where: { id: existing.id },
  });

  return NextResponse.json({ success: true });
}
