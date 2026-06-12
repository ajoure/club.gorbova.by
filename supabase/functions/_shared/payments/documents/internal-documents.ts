// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — internal canonical documents.
//
// Relation: payment.order_id → ai_generated_documents.order_id (UUID-only).
// Identity = document UUID. No version-by-filename. Sort: created_at DESC, then id.
// Signed URL is created per-request (short-lived) via injected signer; not persisted.

import type { InternalDocument } from './types.ts';
import { isSafeSignedStorageUrl } from './url-security.ts';

export interface InternalDocRow {
  id: string;
  order_id: string;
  document_type: string | null;
  status: string | null;
  number: string | null;
  storage_path: string | null;
  file_name: string | null;
  created_at: string;
}

export interface SignedUrlSigner {
  /** Returns { url, expires_at } or null if not available. NEVER persists URL. */
  sign(storagePath: string, fileName: string | null, ttlSeconds: number): Promise<{ url: string; expires_at: string } | null>;
}

export interface InternalDocSource {
  list(orderId: string): Promise<InternalDocRow[]>;
}

export async function resolveInternalDocuments(
  orderId: string | null,
  source: InternalDocSource,
  signer: SignedUrlSigner,
  opts: { ttlSeconds?: number } = {},
): Promise<InternalDocument[]> {
  if (!orderId) return [];
  const rows = await source.list(orderId);
  const ttl = opts.ttlSeconds ?? 300;

  const sorted = [...rows].sort((a, b) => {
    const dt = b.created_at.localeCompare(a.created_at);
    return dt !== 0 ? dt : a.id.localeCompare(b.id);
  });

  const out: InternalDocument[] = [];
  for (const r of sorted) {
    let url: string | null = null;
    let expiresAt: string | null = null;
    if (r.storage_path) {
      try {
        const signed = await signer.sign(r.storage_path, r.file_name, ttl);
        if (signed && isSafeSignedStorageUrl(signed.url)) {
          url = signed.url;
          expiresAt = signed.expires_at;
        }
      } catch { /* swallow; expose as unavailable */ }
    }
    out.push({
      id: r.id,
      order_id: r.order_id,
      document_type: r.document_type,
      status: r.status,
      number: r.number,
      created_at: r.created_at,
      url,
      url_kind: url ? 'signed_storage' : 'unavailable',
      can_open: !!url,
      can_download: !!url,
      can_copy: false,
      expires_at: expiresAt,
    });
  }
  return out;
}
