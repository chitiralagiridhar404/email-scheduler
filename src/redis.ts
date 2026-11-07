import IORedis from "ioredis";
import { config } from "./config";

// BullMQ requires maxRetriesPerRequest: null for blocking connections (workers).
export const createConnection = () =>
  new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// General purpose client (credentials cache, health checks).
export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: 3 });
