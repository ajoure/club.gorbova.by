// Temporary QA helper: creates/resets 2 QA users + 2 QA live events with distinct rule_kind.
// DELETE AFTER PROOF. Only super_admin can call; guarded by app_settings.qa_test_helper_enabled.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QA_USERS = [
  { email: "qa.live.open@gorbova.test", password: "QaLiveOpen!2026" },
  { email: "qa.live.locked@gorbova.test", password: "QaLiveLocked!2026" },
];

// Pick an existing product the QA users definitely do NOT have access to.
// We'll use Gorbova Club (11c9f1b8-0355-4753-bd74-40b42aa53616) — QA users are freshly created,
// so they cannot own any entitlement to it.
const LOCKED_PRODUCT_ID = "11c9f1b8-0355-4753-bd74-40b42aa53616";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // kill-switch
  const { data: flag } = await admin
    .from("app_settings").select("value").eq("key", "qa_test_helper_enabled").maybeSingle();
  const enabled = flag?.value === true || (flag?.value as any) === "true";
  if (!enabled) return json({ error: "helper_disabled" }, 403);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
  if (cErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
  const callerId = claims.claims.sub as string;
  const { data: isSuper } = await admin.rpc("has_role_v2", { _user_id: callerId, _role_code: "super_admin" });
  if (!isSuper) return json({ error: "forbidden_not_super_admin" }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "setup";

  if (action === "cleanup") {
    // Delete QA events and QA users
    const { data: events } = await admin.from("live_events").select("id").ilike("slug", "qa-live-%");
    if (events?.length) {
      const ids = events.map((e: any) => e.id);
      await admin.from("live_event_access_rules").delete().in("live_event_id", ids);
      await admin.from("live_events").delete().in("id", ids);
    }
    const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const toDelete = usersList.users.filter(u => QA_USERS.some(q => q.email === (u.email ?? "").toLowerCase()));
    for (const u of toDelete) await admin.auth.admin.deleteUser(u.id);
    return json({ ok: true, cleaned_events: events?.length ?? 0, cleaned_users: toDelete.length });
  }

  // setup
  const userIds: Record<string, string> = {};
  const { data: existingUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  for (const q of QA_USERS) {
    const existing = existingUsers.users.find(u => (u.email ?? "").toLowerCase() === q.email);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, { password: q.password, email_confirm: true });
      userIds[q.email] = existing.id;
    } else {
      const { data: created, error: cerr } = await admin.auth.admin.createUser({
        email: q.email, password: q.password, email_confirm: true,
      });
      if (cerr) return json({ error: "create_user_failed", email: q.email, details: cerr.message }, 500);
      userIds[q.email] = created.user.id;
    }
  }

  // Events
  const events = [
    { slug: "qa-live-open", title: "[QA] Открытый эфир (any_authenticated)", rule_kind: "any_authenticated", product_id: null as string | null },
    { slug: "qa-live-locked", title: "[QA] Закрытый эфир (product)", rule_kind: "product", product_id: LOCKED_PRODUCT_ID },
  ];
  const eventIds: Record<string, string> = {};
  for (const e of events) {
    // upsert by slug
    const { data: existing } = await admin.from("live_events").select("id").eq("slug", e.slug).maybeSingle();
    let id: string;
    if (existing) {
      id = existing.id;
      await admin.from("live_events").update({
        title: e.title, status: "scheduled", is_published: true,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        event_type: "live_stream", source_kind: "kinescope",
        access_rule: { mode: "all", product_id: null, tariff_id: null },
        invite_mode: "public", direct_access_allowed: true,
      }).eq("id", id);
    } else {
      const { data: ins, error: ierr } = await admin.from("live_events").insert({
        slug: e.slug, title: e.title, status: "scheduled", is_published: true,
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        event_type: "live_stream", source_kind: "kinescope",
        access_rule: { mode: "all", product_id: null, tariff_id: null },
        invite_mode: "none", direct_access_allowed: true,
      }).select("id").single();
      if (ierr) return json({ error: "create_event_failed", slug: e.slug, details: ierr.message }, 500);
      id = ins.id;
    }
    eventIds[e.slug] = id;
    // Reset rules
    await admin.from("live_event_access_rules").delete().eq("live_event_id", id);
    await admin.from("live_event_access_rules").insert({
      live_event_id: id, rule_kind: e.rule_kind, product_id: e.product_id, tariff_id: null,
      sort_order: 0, conditions: {},
    });
  }

  return json({ ok: true, users: QA_USERS.map(u => ({ email: u.email, password: u.password, id: userIds[u.email] })), events: eventIds });
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
