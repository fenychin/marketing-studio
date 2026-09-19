import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { JwtClaims } from "./auth-types.js";

/**
 * Self-implemented auth primitives — zero external dependency:
 * passwords via scrypt, sessions via HS256 JWT.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * API keys are high-entropy random tokens — SHA-256 is the right lookup
 * digest (fast, no salt needed); nothing low-entropy ever goes through here.
 * Plaintext keys are shown once at issue time and never stored.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function jwtSecret(): string {
  return process.env.STUDIO_JWT_SECRET ?? "dev-secret-change-me";
}

export function signJwt(claims: Omit<JwtClaims, "exp">, ttlSec = 7 * 24 * 3600): string {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const signature = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(signature!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString()) as JwtClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** HMAC for payment webhook callbacks. */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Constant-time hex comparison for webhook signatures (both hex digests). */
export function timingSafeEqHex(a: string, b: string): boolean {
  if (typeof b !== "string" || a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Tenant credential vault: AES-256-GCM under a master key. The master key
 * comes from STUDIO_MASTER_KEY (any passphrase → sha256 to 32 bytes); a dev
 * fallback is used only when unset, loudly.
 */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function sealSecret(plain: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(sealed: SealedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function masterKey(): Buffer {
  const raw = process.env.STUDIO_MASTER_KEY?.trim();
  if (!raw) {
    if (!process.env.STUDIO_MASTER_KEY_WARNED) {
      console.warn("[credentials] STUDIO_MASTER_KEY not set — dev fallback key in use; set it in production");
      process.env.STUDIO_MASTER_KEY_WARNED = "1";
    }
    return createHash("sha256").update("dev-master-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}
