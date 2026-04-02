import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGooglePostmasterOverview } from "@/lib/google-postmaster";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(
    Math.max(parseInt(searchParams.get("days") || "30", 10) || 30, 7),
    120
  );

  return NextResponse.json(
    await getGooglePostmasterOverview({
      userId: session.user.id,
      days,
    })
  );
}
