import { Worker } from "bullmq";
import { config } from "./config";
import { createConnection } from "./redis";
import { EmailJobData } from "./queue";
import { sendEmail, SendResult } from "./mailer";

export function startWorker() {
  const worker = new Worker<EmailJobData, SendResult>(
    config.queueName,
    async (job) => {
      const { to, subject, body, html } = job.data;
      const result = await sendEmail({ to, subject, body, html });
      console.log(
        `[worker] sent job=${job.id} to=${to} preview=${result.previewUrl ?? "n/a"}`
      );
      return result;
    },
    {
      connection: createConnection(),
      concurrency: config.concurrency,
      ...(config.rateLimitMax > 0
        ? {
            limiter: {
              max: config.rateLimitMax,
              duration: config.rateLimitWindowMs,
            },
          }
        : {}),
    }
  );

  worker.on("failed", (job, err) =>
    console.error(
      `[worker] failed job=${job?.id} attempt=${job?.attemptsMade}/${config.maxRetries}: ${err.message}`
    )
  );
  worker.on("error", (err) => console.error("[worker] error:", err.message));
  return worker;
}
