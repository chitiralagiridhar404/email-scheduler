import "dotenv/config";

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
};

export const config = {
  port: int(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  concurrency: int(process.env.WORKER_CONCURRENCY, 5),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 0),
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 3_600_000),
  maxRetries: int(process.env.MAX_RETRIES, 3),
  queueName: "email-scheduler",
};
