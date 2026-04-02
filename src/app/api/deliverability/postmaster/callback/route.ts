import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAppUrlDiagnostics } from "@/lib/env";
import {
  connectGooglePostmasterAccount,
  syncGooglePostmasterData,
} from "@/lib/google-postmaster";

const GOOGLE_POSTMASTER_STATE_COOKIE = "google_postmaster_oauth_state";

export async function GET(req: NextRequest) {
  const session = await auth();
  const appUrl = getAppUrlDiagnostics().url;

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const storedState = req.cookies.get(GOOGLE_POSTMASTER_STATE_COOKIE)?.value;

  const response = NextResponse.redirect(new URL("/deliverability", appUrl));
  response.cookies.delete(GOOGLE_POSTMASTER_STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(
      new URL(`/deliverability?postmaster_error=${encodeURIComponent(error)}`, appUrl)
    );
  }

  if (!code || !state || storedState !== `${session.user.id}:${state}`) {
    return NextResponse.redirect(
      new URL("/deliverability?postmaster_error=invalid-state", appUrl)
    );
  }

  try {
    await connectGooglePostmasterAccount(session.user.id, code);
    await syncGooglePostmasterData({ userId: session.user.id, days: 30 });
    return response;
  } catch (callbackError) {
    const message =
      callbackError instanceof Error
        ? callbackError.message
        : "Unable to connect Google Postmaster";

    return NextResponse.redirect(
      new URL(
        `/deliverability?postmaster_error=${encodeURIComponent(message)}`,
        appUrl
      )
    );
  }
}
