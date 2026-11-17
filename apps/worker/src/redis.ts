import type { ConnectionOptions } from 'bullmq';

/** Turns REDIS_URL into BullMQ connection options. */
export function redisConnection(
  url = process.env.REDIS_URL ?? 'redis://localhost:6379',
): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers: blocking commands must not be retried per request.
    maxRetriesPerRequest: null,
  };
}
