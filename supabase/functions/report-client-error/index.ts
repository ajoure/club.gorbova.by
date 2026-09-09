import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { requireAdminSectionAccess } from "../_shared/admin-section-auth.ts";
import { validRouteErrorDiagnostic } from "../_shared/route-error-diagnostic.ts";
import { ACTION, handleReport, type StoredReport } from "./handler.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function report(row: { id: string; meta: unknown } | null): StoredReport | null {
  if (!row || !validRouteErrorDiagnostic(row.meta)) return null;
  return { id: row.id, diagnostic: row.meta };
}
Deno.serve(req => handleReport(req, {
  authenticate: req => requireAdminSectionAccess(req, admin, "deals", "view"),
  now: () => Date.now(),
  async slotId(actorId, minute) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ACTION}:v1:${actorId}:${minute}`))).slice(0, 16);
    bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
    const hex = [...bytes].map(n => n.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
  async recent(actorId, since) {
    const { data, error } = await admin.from("audit_logs").select("id,meta").eq("action", ACTION).eq("actor_user_id", actorId).gte("created_at", since).order("created_at", { ascending: false }).limit(11);
    if (error) throw new Error("read_failed");
    return (data ?? []).map(report).filter((r): r is StoredReport => r !== null);
  },
  async insert(id, actorId, diagnostic) {
    const { error } = await admin.from("audit_logs").insert({ id, action: ACTION, actor_type: "user", actor_user_id: actorId,
      actor_label: "Диагностика страницы сделок", entity_type: "frontend", meta: diagnostic });
    if (error?.code === "23505") return "conflict";
    if (error) throw new Error("write_failed");
    return "inserted";
  },
  async read(id, actorId) {
    const { data, error } = await admin.from("audit_logs").select("id,meta").eq("id", id).eq("action", ACTION).eq("actor_user_id", actorId).maybeSingle();
    if (error) throw new Error("read_failed");
    return report(data);
  },
}));
