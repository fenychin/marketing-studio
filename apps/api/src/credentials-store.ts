import { db } from "./db/index.js";
import { nowIso, uuid } from "./config.js";
import { openSecret, sealSecret, type SealedSecret } from "./auth-crypto.js";

/**
 * Tenant credential vault: secrets are AES-256-GCM sealed at rest and only
 * ever resolved in-memory for provider calls. Plaintext is never returned by
 * any API surface.
 */

export interface CredentialRow {
  id: string;
  tenant_id: string;
  ref: string;
  kind: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_at: string;
}

const REF_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function validRef(ref: string): boolean {
  return REF_RE.test(ref);
}

export async function storeSecret(tenantId: string, ref: string, kind: string, plain: string): Promise<void> {
  const sealed = sealSecret(plain);
  const existing = await db().get<CredentialRow>("SELECT id FROM credentials WHERE tenant_id=? AND ref=?", [tenantId, ref]);
  if (existing) {
    await db().run("UPDATE credentials SET kind=?, ciphertext=?, iv=?, auth_tag=? WHERE id=?", [
      kind, sealed.ciphertext, sealed.iv, sealed.authTag, existing.id,
    ]);
    return;
  }
  await db().run(
    "INSERT INTO credentials(id,tenant_id,ref,kind,ciphertext,iv,auth_tag,created_at) VALUES(?,?,?,?,?,?,?,?)",
    [uuid(), tenantId, ref, kind, sealed.ciphertext, sealed.iv, sealed.authTag, nowIso()],
  );
}

export async function listRefs(tenantId: string): Promise<Array<{ ref: string; kind: string; createdAt: string }>> {
  const rows = await db().all<{ ref: string; kind: string; created_at: string }>(
    "SELECT ref,kind,created_at FROM credentials WHERE tenant_id=? ORDER BY created_at",
    [tenantId],
  );
  return rows.map((r) => ({ ref: r.ref, kind: r.kind, createdAt: r.created_at }));
}

export async function deleteSecret(tenantId: string, ref: string): Promise<boolean> {
  const row = await db().get<CredentialRow>("SELECT id FROM credentials WHERE tenant_id=? AND ref=?", [tenantId, ref]);
  if (!row) return false;
  await db().run("DELETE FROM credentials WHERE id=?", [row.id]);
  return true;
}

export async function resolveSecret(tenantId: string, ref: string): Promise<string | null> {
  const row = await db().get<CredentialRow>("SELECT * FROM credentials WHERE tenant_id=? AND ref=?", [tenantId, ref]);
  if (!row) return null;
  try {
    return openSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag } as SealedSecret);
  } catch {
    return null; // wrong master key or corrupted row — fail closed
  }
}
