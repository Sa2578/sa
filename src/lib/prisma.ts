import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: getDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10,
  });

  return new PrismaClient({ adapter });
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
