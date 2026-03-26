import net from "node:net";
import tls from "node:tls";
import { getRedisUrl } from "./env";

export interface RedisConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

export function getRedisConnectionConfig(): RedisConnectionConfig {
  const redisUrl = new URL(getRedisUrl());
  const db = redisUrl.pathname.length > 1 ? Number.parseInt(redisUrl.pathname.slice(1), 10) : undefined;

  return {
    host: redisUrl.hostname,
    port: Number.parseInt(redisUrl.port || "6379", 10),
    username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
    password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: redisUrl.protocol === "rediss:" ? {} : undefined,
  };
}

export function openRedisHealthSocket() {
  const config = getRedisConnectionConfig();

  if (config.tls) {
    return tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
    });
  }

  return net.createConnection({
    host: config.host,
    port: config.port,
  });
}
