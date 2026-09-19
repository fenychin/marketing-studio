import type { FastifyReply, FastifyRequest } from "fastify";
import { audit } from "./db/index.js";

/**
 * In-process token bucket per tenant. Capacity/refill are per class; a
 * multi-instance deployment moves the bucket to Redis behind the same
 * `allow()` signature.
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

const CLASSES = {
  general: { capacity: 120, refillPerSec: 2 },     // ~120 req/min sustained
  generate: { capacity: 10, refillPerSec: 0.2 },   // ~12 submits/min burst 10
} as const;

export type RateClass = keyof typeof CLASSES;

export function allow(key: string, rateClass: RateClass): boolean {
  const { capacity, refillPerSec } = CLASSES[rateClass];
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    buckets.set(key, bucket);
  }
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function rateLimit(generalClass: RateClass = "general"): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/v1/")) return;
    const tenant = request.tenant;
    if (!tenant) return;

    if (!allow(`${tenant.id}:general`, "general")) {
      return reply.code(429).header("retry-after", "1").send({
        error: { code: "rate_limited", message: "Too many requests — slow down." },
      });
    }
    if (request.method === "POST" && url.startsWith("/v1/generations")) {
      if (!allow(`${tenant.id}:generate`, "generate")) {
        void audit(tenant.id, "ratelimit.blocked", url, {});
        return reply.code(429).header("retry-after", "5").send({
          error: { code: "rate_limited", message: "Generation submit limit reached — retry shortly." },
        });
      }
    }
  };
}
