import { prisma } from "./prisma";
import { openRedisHealthSocket } from "./redis";

export function getStartOfCurrentDay() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { ok: false as const, message };
  }
}

export async function checkRedisHealth() {
  return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
    const socket = openRedisHealthSocket();

    socket.once("connect", () => {
      socket.end();
      resolve({ ok: true });
    });

    socket.once("error", (error) => {
      socket.destroy();
      resolve({ ok: false, message: error.message });
    });

    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve({ ok: false, message: "Redis connection timed out" });
    });
  });
}
