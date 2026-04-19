// One-time / on-demand backfill of instagram_contacts.avatar_url for ManyChat-provider contacts.
// Pulls profile_pic from /fb/subscriber/getInfo for contacts where avatar_url IS NULL.
//
// Auth: requires service-role JWT or admin user. We rely on verify_jwt + RLS check on caller.
// Body: { instance_id?: string, limit?: number }
//   - instance_id: ограничить scope одной интеграцией (рекомендуется)
//   - limit: max контактов за вызов (default 50, max 200)
//
// Возвращает { success, processed, updated, skipped, errors }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchAvatar(apiKey: string, subscriberId: string): Promise<string | null> {
  const subId = /^\d+$/.test(subscriberId) ? Number(subscriberId) : subscriberId;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(
      `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(String(subId))}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      },
    );
    clearTimeout(t);
    if (!resp.ok) return null;
    const j: any = await resp.json().catch(() => null);
    const pic = j?.data?.profile_pic ?? j?.data?.profile_pic_url ?? null;
    if (typeof pic === "string" && /^https?:\/\//i.test(pic)) return pic;
    return null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch {}
  const instanceIdFilter: string | null = typeof body?.instance_id === "string" ? body.instance_id : null;
  const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);

  // 1) Resolve ManyChat instances
  const { data: instances, error: instErr } = await supabase
    .from("integration_instances")
    .select("id, config_secrets")
    .eq("provider", "manychat")
    .eq(instanceIdFilter ? "id" : "provider", instanceIdFilter || "manychat");
  if (instErr) return json({ success: false, error: instErr.message }, 500);

  const fallbackKey = Deno.env.get("MANYCHAT_API_TOKEN") || null;
  const accountToKey = new Map<string, string>();

  // 2) Map accounts → api_key
  for (const inst of instances || []) {
    const apiKey = (inst.config_secrets as any)?.api_key || fallbackKey;
    if (!apiKey) continue;
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id")
      .eq("integration_instance_id", inst.id)
      .eq("provider_kind", "manychat");
    for (const a of accounts || []) accountToKey.set(a.id, apiKey);
  }

  if (accountToKey.size === 0) {
    return json({ success: true, processed: 0, updated: 0, skipped: 0, errors: 0, note: "no_accounts_or_keys" });
  }

  // 3) Fetch contacts to backfill
  const { data: contacts, error: ctErr } = await supabase
    .from("instagram_contacts")
    .select("id, instagram_account_id, instagram_user_id")
    .eq("provider_kind", "manychat")
    .is("avatar_url", null)
    .in("instagram_account_id", Array.from(accountToKey.keys()))
    .limit(limit);
  if (ctErr) return json({ success: false, error: ctErr.message }, 500);

  let updated = 0, skipped = 0, errors = 0;
  for (const c of contacts || []) {
    const apiKey = accountToKey.get(c.instagram_account_id);
    if (!apiKey || !c.instagram_user_id) { skipped++; continue; }
    const url = await fetchAvatar(apiKey, c.instagram_user_id);
    if (!url) { skipped++; continue; }
    const { error: upErr } = await supabase
      .from("instagram_contacts")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (upErr) { errors++; console.error("[backfill] update_failed", c.id, upErr.message); }
    else updated++;
    // Soft throttle (~10 RPS)
    await new Promise((r) => setTimeout(r, 100));
  }

  return json({
    success: true,
    processed: contacts?.length || 0,
    updated,
    skipped,
    errors,
  });
});
