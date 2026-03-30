import { NextResponse } from "next/server";
import { z } from "zod";
import { isWebhookAuthorized } from "@/lib/webhook-auth";
import { syncInboxReplies } from "@/lib/reply-sync";

const syncRepliesSchema = z
  .object({
    inboxId: z.string().trim().min(1).optional(),
    inboxEmailAddress: z.string().trim().toLowerCase().email().optional(),
    lookbackDays: z.number().int().min(1).max(60).optional(),
  })
  .refine((data) => Boolean(data.inboxId || data.inboxEmailAddress), {
    message: "Inbox ID or inbox email address is required",
    path: ["inboxId"],
  });

export async function POST(req: Request) {
  try {
    if (!isWebhookAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = syncRepliesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const result = await syncInboxReplies({
      inboxId: parsed.data.inboxId,
      inboxEmailAddress: parsed.data.inboxEmailAddress,
      lookbackDays: parsed.data.lookbackDays,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync replies";
    const status = message === "Inbox not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
