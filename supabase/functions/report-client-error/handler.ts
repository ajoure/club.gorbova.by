import { handleCorsPreflightRequest, jsonResponse } from "../_shared/cors.ts";
import { validRouteErrorDiagnostic, type RouteErrorDiagnostic } from "../_shared/route-error-diagnostic.ts";

export const ACTION = "frontend.route_error";
const MAX_BYTES = 4096;
export interface StoredReport { id: string; diagnostic: RouteErrorDiagnostic }
export interface Dependencies {
  authenticate(req: Request): Promise<{ ok: true; actor: { id: string } } | { ok: false; status: number; error: string }>;
  recent(actorId: string, since: string): Promise<StoredReport[]>;
  insert(slotId: string, actorId: string, diagnostic: RouteErrorDiagnostic): Promise<"inserted" | "conflict">;
  read(slotId: string, actorId: string): Promise<StoredReport | null>;
  now(): number;
  slotId(actorId: string, minute: number): Promise<string>;
}
async function readPayload(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("invalid_payload");
  if (Number(req.headers.get("content-length")) > MAX_BYTES || !req.body) throw new Error("invalid_payload");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("invalid_payload"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
/** One DB-unique slot per actor/server UTC minute: strict cross-isolate write cap, no schema changes.
 * Same event retries are idempotent for 10 minutes. A different event in an occupied slot
 * is NOT claimed saved; the browser retains its own copy. No raw client strings are logged.
 */
export async function handleReport(req: Request, deps: Dependencies): Promise<Response> {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  try {
    const auth = await deps.authenticate(req);
    if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
    let payload: unknown;
    try { payload = await readPayload(req); } catch { return jsonResponse({ error: "invalid_payload" }, 400); }
    if (!validRouteErrorDiagnostic(payload)) return jsonResponse({ error: "invalid_payload" }, 400);
    const now = deps.now();
    const recent = await deps.recent(auth.actor.id, new Date(now - 600_000).toISOString());
    const existing = recent.find(row => row.diagnostic.id === payload.id);
    if (existing) return jsonResponse({ ok: true, id: payload.id, stored_id: existing.id, deduplicated: true });
    const slotId = await deps.slotId(auth.actor.id, Math.floor(now / 60_000));
    const result = await deps.insert(slotId, auth.actor.id, payload);
    // Mandatory read-back also covers a concurrent retry/PK collision.
    const stored = await deps.read(slotId, auth.actor.id);
    if (!stored) return jsonResponse({ error: "not_confirmed" }, 503);
    if (stored.diagnostic.id !== payload.id) return jsonResponse({ error: "rate_limited" }, 429);
    return jsonResponse({ ok: true, id: payload.id, stored_id: slotId, deduplicated: result === "conflict" });
  } catch { return jsonResponse({ error: "not_confirmed" }, 503); }
}
