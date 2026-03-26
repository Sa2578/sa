import { Queue } from "bullmq";
import { getRedisConnectionConfig } from "./redis";

let emailQueue: Queue | null = null;

export function getRedisConnection() {
  return getRedisConnectionConfig();
}

export function getEmailQueue() {
  if (!emailQueue) {
    emailQueue = new Queue("email-sending", {
      connection: getRedisConnection(),
    });
  }

  return emailQueue;
}
