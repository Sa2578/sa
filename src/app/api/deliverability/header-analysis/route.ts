import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  headerPlacementValues,
  persistHeaderAnalysis,
} from "@/lib/header-analysis-persistence";

const headerSchema = z.object({
  rawHeaders: z.string().trim().min(1).optional(),
  emailLogId: z.string().trim().min(1).optional(),
  placement: z.enum(headerPlacementValues).optional(),
  mailboxProvider: z.string().trim().min(1).max(64).optional(),
}).superRefine((data, ctx) => {
  const hasHeaders = Boolean(data.rawHeaders);
  const hasPlacementObservation =
    Boolean(data.emailLogId) && Boolean(data.placement) && data.placement !== "UNKNOWN";

  if (!hasHeaders && !hasPlacementObservation) {
    ctx.addIssue({
      code: "custom",
      message: "Provide raw headers, or select an email log and a placement to save",
      path: ["rawHeaders"],
    });
  }
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = headerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    return NextResponse.json(
      await persistHeaderAnalysis({
        rawHeaders: parsed.data.rawHeaders,
        emailLogId: parsed.data.emailLogId,
        placement: parsed.data.placement,
        userId: session.user.id,
        mailboxProvider: parsed.data.mailboxProvider,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze headers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
