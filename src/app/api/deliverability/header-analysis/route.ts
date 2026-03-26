import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { analyzeRawHeaders } from "@/lib/header-analysis";

const headerSchema = z.object({
  rawHeaders: z.string().trim().min(1),
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

    return NextResponse.json(analyzeRawHeaders(parsed.data.rawHeaders));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze headers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
