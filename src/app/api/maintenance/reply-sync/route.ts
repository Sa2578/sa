import { NextResponse } from "next/server";
import { z } from "zod";
import { syncReplyBatch } from "@/lib/reply-sync";
import { isMaintenanceAuthorized } from "@/lib/webhook-auth";

const maintenanceReplySyncSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  inboxIds: z.array(z.string().trim().min(1)).max(100).optional(),
  lookbackDays: z.number().int().min(1).max(60).optional(),
  maxMessages: z.number().int().min(1).max(1000).optional(),
  maxInboxes: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    if (!isMaintenanceAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized maintenance request" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = maintenanceReplySyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const result = await syncReplyBatch(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run reply sync";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
