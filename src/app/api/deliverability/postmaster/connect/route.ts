import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAppUrlDiagnostics, isGooglePostmasterConfigured } from "@/lib/env";
import { createGooglePostmasterAuthorizeUrl } from "@/lib/google-postmaster";

const GOOGLE_POSTMASTER_STATE_COOKIE = "google_postmaster_oauth_state";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", getAppUrlDiagnostics().url));
  }

  if (!isGooglePostmasterConfigured()) {
    return NextResponse.redirect(
      new URL("/deliverability?postmaster=missing-config", getAppUrlDiagnostics().url)
    );
  }

  const state = randomUUID();
  const response = NextResponse.redirect(createGooglePostmasterAuthorizeUrl(state));
  response.cookies.set({
    name: GOOGLE_POSTMASTER_STATE_COOKIE,
    value: `${session.user.id}:${state}`,
    httpOnly: true,
    sameSite: "lax",
    secure: getAppUrlDiagnostics().isHttps,
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
