import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncMailboxPlacementForEmailLog } from "@/lib/mailbox-placement-sync";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; logId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, logId } = await params;
    const result = await syncMailboxPlacementForEmailLog({
      userId: session.user.id,
      senderInboxId: id,
      emailLogId: logId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to check mailbox placement";

    const status =
      message === "Email log not found"
        ? 404
        : message ===
            "Recipient mailbox is not configured as a managed inbox or monitoring mailbox in this account"
          ? 400
          : 502;

    return NextResponse.json({ error: message }, { status });
  }
}
