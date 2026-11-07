import { Queue, QueueEvents } from "bullmq";
import { config } from "./config";
import { createConnection } from "./redis";

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
  sendAt: string; // ISO timestamp, informational (the real schedule is the BullMQ delay)
  createdAt: string;
}

export const emailQueue = new Queue<EmailJobData>(config.queueName, {
  connection: createConnection(),
  defaultJobOptions: {
    attempts: config.maxRetries,
    backoff: { type: "exponential", delay: 5_000 },
    // Keep history so the dashboard can show sent / failed emails.
    removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
  },
});

export const queueEvents = new QueueEvents(config.queueName, {
  connection: createConnection(),
});

/**
 * Schedule an email. The job is stored in Redis as a *delayed* job; BullMQ
 * moves it to "waiting" when the delay elapses. No cron / setTimeout involved,
 * so a server restart does not lose or reset anything.
 */
export async function scheduleEmail(data: Omit<EmailJobData, "createdAt">) {
  const delay = Math.max(0, new Date(data.sendAt).getTime() - Date.now());
  return emailQueue.add(
    "send-email",
    { ...data, createdAt: new Date().toISOString() },
    { delay }
  );
}
