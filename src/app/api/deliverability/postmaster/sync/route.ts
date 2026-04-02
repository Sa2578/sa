import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncGooglePostmasterData } from "@/lib/google-postmaster";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedDays =
    typeof body?.days === "number" && Number.isFinite(body.days) ? body.days : 30;
  const days = Math.min(Math.max(Math.trunc(requestedDays), 7), 120);

  try {
    return NextResponse.json(
      await syncGooglePostmasterData({
        userId: session.user.id,
        days,
      })
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync Google Postmaster data";

    const status =
      message === "Google Postmaster account not connected"
        ? 400
        : message.includes("not configured")
          ? 503
          : 502;

    return NextResponse.json({ error: message }, { status });
  }
}
