import { NextResponse } from "next/server";
import { assertRequiredEnv, getAppUrlDiagnostics } from "@/lib/env";
import { checkDatabaseHealth, checkRedisHealth } from "@/lib/runtime";

export async function GET() {
  try {
    assertRequiredEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid environment";
    return NextResponse.json(
      {
        status: "error",
        env: { ok: false, message },
      },
      { status: 500 }
    );
  }

  const [database, redis] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const healthy = database.ok && redis.ok;
  const appUrl = getAppUrlDiagnostics();

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      env: { ok: true },
      appUrl,
      services: {
        database,
        redis,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
