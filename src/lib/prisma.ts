import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Ensure DATABASE_URL is present before constructing the client.
  getDatabaseUrl();
  return new PrismaClient();
}

function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient() as PrismaClient & Record<PropertyKey, unknown>;
    const value = client[prop];

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});
