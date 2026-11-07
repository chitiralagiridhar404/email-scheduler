import express from "express";
import path from "path";
import { config } from "./config";
import { api } from "./routes";
import { redis } from "./redis";
import { emailQueue, queueEvents } from "./queue";
import { startWorker } from "./worker";
import { getMailer } from "./mailer";

async function main() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await redis.ping();
      res.json({ status: "ok", redis: "up" });
    } catch {
      res.status(503).json({ status: "degraded", redis: "down" });
    }
  });

  app.use("/api", api);
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Express 4 error handler for async route failures
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[http]", err);
    res.status(500).json({ error: "internal_error" });
  });

  // Warm up the Ethereal account before accepting work.
  // Non-fatal: if Ethereal is unreachable now, sends retry with backoff later.
  await getMailer().catch((e) =>
    console.warn("[mailer] Ethereal account not ready yet:", e.message)
  );

  // Jobs already in Redis (delayed/waiting/active) are picked up automatically
  // on boot; stalled "active" jobs from a crash are re-queued by BullMQ.
  const worker = startWorker();

  const server = app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}  (dashboard at /)`);
  });

  const shutdown = async (sig: string) => {
    console.log(`[server] ${sig} received, shutting down gracefully`);
    server.close();
    await worker.close(); // waits for in-flight jobs
    await emailQueue.close();
    await queueEvents.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
