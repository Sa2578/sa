import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { syncInboxReplies } from "@/lib/reply-sync";

const syncRepliesSchema = z.object({
  lookbackDays: z.number().int().min(1).max(60).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = syncRepliesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const result = await syncInboxReplies({
      userId: session.user.id,
      inboxId: id,
      lookbackDays: parsed.data.lookbackDays,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync replies";
    const status = message === "Inbox not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
