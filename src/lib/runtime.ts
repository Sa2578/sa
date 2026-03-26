import net from "node:net";
import { prisma } from "./prisma";
import { getRedisUrl } from "./env";

function getRedisConnectionDetails() {
  const url = new URL(getRedisUrl());
  return {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
  };
}

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
  const { host, port } = getRedisConnectionDetails();

  return new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
    const socket = net.createConnection({ host, port });

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
