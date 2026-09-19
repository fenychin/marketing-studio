import type { FastifyInstance } from "fastify";
import { db, audit } from "../db/index.js";
import { nowIso, uuid } from "../config.js";
import { charge } from "../credits.js";
import { signPayload } from "../auth-crypto.js";

/**
 * Billing: checkout sessions + credit top-ups. The mock provider completes
 * instantly (sandbox-style); real providers (Stripe etc.) implement the same
 * PaymentProvider surface and call the signature-verified webhook.
 */

export interface PaymentRow {
  id: string;
  tenant_id: string;
  provider: string;
  status: "pending" | "completed" | "cancelled";
  credits: number;
  amount_cents: number;
  currency: string;
  session_id: string;
  created_at: string;
  completed_at: string | null;
}

const PACKS: Record<number, number> = { 500: 490, 2000: 1900, 10000: 7900 }; // credits → cents

export function priceFor(credits: number): number | undefined {
  return PACKS[credits];
}

async function completePayment(row: PaymentRow): Promise<void> {
  await db().run("UPDATE payments SET status='completed', completed_at=? WHERE id=?", [nowIso(), row.id]);
  await charge(row.tenant_id, row.credits, `topup:${row.session_id}`);
  await audit(row.tenant_id, "billing.completed", row.id, { credits: row.credits, amountCents: row.amount_cents });
}

export function registerBillingRoutes(app: FastifyInstance): void {
  app.post("/v1/billing/checkout", async (request, reply) => {
    const tenantId = request.tenant!.id;
    const body = (request.body ?? {}) as { credits?: number; provider?: string };
    const credits = Number(body.credits ?? 0);
    const amountCents = priceFor(credits);
    if (!amountCents) {
      return reply.code(400).send({ error: { code: "invalid_pack", message: `credits must be one of ${Object.keys(PACKS).join(", ")}.` } });
    }
    const provider = body.provider ?? "mock";
    const sessionId = `sess_${uuid().replace(/-/g, "")}`;
    await db().run(
      "INSERT INTO payments(id,tenant_id,provider,status,credits,amount_cents,currency,session_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [uuid(), tenantId, provider, "pending", credits, amountCents, "usd", sessionId, nowIso()],
    );
    await audit(tenantId, "billing.checkout", sessionId, { credits, amountCents, provider });

    // Real providers return their hosted checkout URL here instead.
    return reply.code(201).send({
      sessionId,
      credits,
      amountCents,
      checkoutUrl: `/mock-pay/${sessionId}`,
      confirm: provider === "mock" ? "POST /v1/billing/mock/confirm" : undefined,
    });
  });

  app.post("/v1/billing/mock/confirm", async (request, reply) => {
    const body = (request.body ?? {}) as { sessionId?: string };
    const row = await db().get<PaymentRow>("SELECT * FROM payments WHERE session_id=?", [body.sessionId ?? ""]);
    if (!row || row.tenant_id !== request.tenant!.id) {
      return reply.code(404).send({ error: { code: "not_found", message: "Unknown session." } });
    }
    if (row.status === "completed") {
      return { status: "completed", credits: row.credits, idempotent: true };
    }
    await completePayment(row);
    return { status: "completed", credits: row.credits, idempotent: false };
  });

  /** Real-provider callback: HMAC-SHA256 hex signature over the raw body. */
  app.post("/v1/billing/webhook", async (request, reply) => {
    const secret = process.env.STUDIO_PAYMENT_WEBHOOK_SECRET;
    const signature = request.headers["x-studio-signature"];
    if (!secret || typeof signature !== "string") {
      return reply.code(400).send({ error: { code: "bad_webhook", message: "Missing webhook secret or signature." } });
    }
    const raw = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    if (signPayload(raw, secret) !== signature) {
      return reply.code(401).send({ error: { code: "bad_signature", message: "Signature mismatch." } });
    }
    const body = (typeof request.body === "string" ? JSON.parse(request.body) : request.body) as { sessionId?: string };
    const row = await db().get<PaymentRow>("SELECT * FROM payments WHERE session_id=?", [body.sessionId ?? ""]);
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "Unknown session." } });
    if (row.status !== "completed") await completePayment(row);
    return { received: true };
  });

  app.get("/v1/billing/payments", async (request) => {
    const rows = await db().all<PaymentRow>(
      "SELECT * FROM payments WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50",
      [request.tenant!.id],
    );
    return { payments: rows };
  });
}
