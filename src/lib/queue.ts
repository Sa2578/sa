import { Queue } from "bullmq";
import { getRedisUrl } from "./env";

let emailQueue: Queue | null = null;

export function getRedisConnection() {
  const redisUrl = new URL(getRedisUrl());

  return {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || "6379", 10),
  };
}

export function getEmailQueue() {
  if (!emailQueue) {
    emailQueue = new Queue("email-sending", {
      connection: getRedisConnection(),
    });
  }

  return emailQueue;
}
