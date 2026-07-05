// deno-lint-ignore-file no-explicit-any
// Public endpoint: submit a lead request from a product page or a SitePage ButtonSection.
//
// v2 (2026-07-05): canonical inline-auth path. Caller MUST be authenticated
//   — email is taken from the session, profile is resolved by auth.uid().
//   Idempotency is scoped by (offer_id, user_id, 15 min) plus a fallback
//   contact-based window for safety.
//
// Guarantees preserved from v1:
// - Writes a lead-only row into public.orders_v2 (status='lead', amount=0).
// - Creates crm_tasks + crm_task_notifications from crm_task_automation_rules of the offer.
// - Never touches payments_v2 / entitlements / subscriptions_v2 / access_grant_ledger.
// - Never calls bePaid / Stripe / any acquirer.
// - Never creates auth.users (auth.users is created by inline-auth signup on the client).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const PROJECT_URLS = [
  "https://id-preview--796a93b9-74cc-403c-8ec5-cafdb2a5beaa.lovable.app",
  "https://gorbova.lovable.app",
  "https://gorbova.by",
  "https://calendar.club.gorbova.by",
  "https://zg.gorbova.by",
  "https://consultation.gorbova.by",
  "https://cb.gorbova.by",
  "https://cons.gorbova.by",
  "https://club.gorbova.by",
];
const SYSTEM_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const IDEMPOTENCY_WINDOW_MINUTES = 15;

function corsHeaders(origin: string | null) {
  const allowed =
    origin && PROJECT_URLS.includes(origin) ? origin : PROJECT_URLS[1];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const BodySchema = z.object({
  offer_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional().nullable(),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d+]/g, ""))
    .refine((v) => v === "" || /^\+?\d{5,20}$/.test(v), "invalid phone")
    .optional()
    .nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
  // anti-bot
  website: z.string().optional().nullable(), // honeypot — must be empty
  form_opened_at: z.number().int().nonnegative().optional(),
});

function jsonResponse(body: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Auth (required) ──────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "auth_required" }, 401, cors);
  }
  const jwt = authHeader.slice("Bearer ".length);

  // We use the anon key + user JWT to resolve auth.uid() securely.
  const supaAsUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await supaAsUser.auth.getUser(jwt);
  const authUserId = userData?.user?.id;
  const authEmail = userData?.user?.email?.toLowerCase();
  if (userErr || !authUserId || !authEmail) {
    return jsonResponse({ error: "auth_invalid" }, 401, cors);
  }

  // Privileged client for writes.
  const supa = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, cors);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
      400,
      cors,
    );
  }
  const { offer_id, name: bodyName, phone: bodyPhone, comment, website, form_opened_at } =
    parsed.data;

  // Honeypot & timing checks — return fake success to avoid signalling bots.
  const nowMs = Date.now();
  const tooFast =
    typeof form_opened_at === "number" && nowMs - form_opened_at < 2000;
  if ((website && website.trim() !== "") || tooFast) {
    return jsonResponse({ ok: true, deduped: true }, 200, cors);
  }

  // 1. Load offer + tariff + product; validate type=lead
  const { data: offer, error: offerErr } = await supa
    .from("tariff_offers")
    .select("id, offer_type, tariff_id, is_active, meta")
    .eq("id", offer_id)
    .maybeSingle();
  if (offerErr || !offer) {
    console.error("[submit-lead-request] offer lookup", { offer_id, offerErr });
    return jsonResponse({ error: "offer_not_found" }, 404, cors);
  }
  if (offer.offer_type !== "lead" || !offer.is_active) {
    return jsonResponse({ error: "offer_not_lead" }, 400, cors);
  }
  const { data: tariff } = await supa
    .from("tariffs")
    .select("id, product_id, currency")
    .eq("id", offer.tariff_id)
    .maybeSingle();
  const productId = tariff?.product_id ?? null;
  const currency = tariff?.currency ?? "BYN";
  const routing = (offer.meta as any)?.crm_routing ?? null;

  // 2. Profile: resolve strictly by auth.uid(). If missing (unusual — trigger
  //    normally creates one on signup), create a minimal profile row.
  const { data: existingProfile } = await supa
    .from("profiles")
    .select("id, user_id, email, phone, full_name")
    .eq("user_id", authUserId)
    .maybeSingle();

  let profileId: string | null = existingProfile?.id ?? null;
  if (!profileId) {
    const { data: created, error: createProfErr } = await supa
      .from("profiles")
      .insert({
        user_id: authUserId,
        email: authEmail,
        full_name: bodyName ?? null,
        phone: bodyPhone && bodyPhone !== "" ? bodyPhone : null,
      })
      .select("id, user_id, email, phone, full_name")
      .single();
    if (createProfErr || !created) {
      console.error("[submit-lead-request] profile create failed", createProfErr);
      return jsonResponse({ error: "profile_create_failed" }, 500, cors);
    }
    profileId = created.id;
  } else {
    // Soft update: only fill blank fields, never overwrite existing values.
    const patch: Record<string, unknown> = {};
    if (!existingProfile!.full_name && bodyName) patch.full_name = bodyName;
    if (!existingProfile!.phone && bodyPhone && bodyPhone !== "") patch.phone = bodyPhone;
    if (Object.keys(patch).length > 0) {
      await supa.from("profiles").update(patch).eq("id", profileId);
    }
  }

  // Effective contact snapshot for CRM/tasks.
  const effectiveName =
    bodyName ??
    existingProfile?.full_name ??
    authEmail;
  const effectivePhone =
    (bodyPhone && bodyPhone !== "" ? bodyPhone : null) ??
    existingProfile?.phone ??
    null;
  const effectiveEmail = authEmail;

  // 3. Idempotency window — primary key: (offer_id, user_id).
  //    Fallback contact-based dedup for legacy anon rows still counts.
  const sinceIso = new Date(
    Date.now() - IDEMPOTENCY_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const orFilterParts = [`profile_id.eq.${profileId}`, `customer_email.eq.${effectiveEmail}`];
  if (effectivePhone) orFilterParts.push(`customer_phone.eq.${effectivePhone}`);
  const { data: existing } = await supa
    .from("orders_v2")
    .select("id")
    .eq("offer_id", offer_id)
    .eq("status", "lead")
    .gte("created_at", sinceIso)
    .or(orFilterParts.join(","))
    .limit(1)
    .maybeSingle();
  if (existing) {
    return jsonResponse(
      { ok: true, deduped: true, order_id: existing.id },
      200,
      cors,
    );
  }

  // 4. Insert orders_v2 (lead)
  const orderNumber = `LEAD-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  const orderMeta: Record<string, unknown> = {
    kind: "lead",
    lead_form: { name: effectiveName, comment: comment ?? null },
    contact_snapshot: { name: effectiveName, email: effectiveEmail, phone: effectivePhone },
    origin: "lead_form",
    auth_user_id: authUserId,
  };

  const { data: insertedOrder, error: orderErr } = await supa
    .from("orders_v2")
    .insert({
      order_number: orderNumber,
      offer_id,
      tariff_id: offer.tariff_id,
      product_id: productId,
      profile_id: profileId,
      user_id: authUserId,
      status: "lead",
      base_price: 0,
      final_price: 0,
      paid_amount: 0,
      currency,
      is_trial: false,
      customer_email: effectiveEmail,
      customer_phone: effectivePhone,
      pipeline_id: routing?.enabled ? routing.pipeline_id ?? null : null,
      pipeline_stage_id: routing?.enabled
        ? routing.stage_on_pending ?? null
        : null,
      meta: orderMeta,
    })
    .select("id")
    .single();
  if (orderErr || !insertedOrder) {
    console.error("[submit-lead-request] order insert failed", orderErr);
    return jsonResponse({ error: "order_create_failed" }, 500, cors);
  }
  const orderId = insertedOrder.id;

  // 5. Load active automation rules for the offer
  const { data: rules } = await supa
    .from("crm_task_automation_rules")
    .select(
      "id, task_type_id, title_template, description_template, assignee_strategy, assignee_user_id, due_offset_minutes, reminder_offset_minutes, metadata",
    )
    .eq("offer_id", offer_id)
    .eq("is_active", true);

  const createdTasks: string[] = [];
  const createdNotifications: string[] = [];

  for (const rule of rules ?? []) {
    if (rule.assignee_strategy !== "fixed_user" || !rule.assignee_user_id) {
      continue;
    }
    const dueOffset = rule.due_offset_minutes ?? 1440;
    const dueAt = new Date(Date.now() + dueOffset * 60_000).toISOString();
    const remindAt =
      rule.reminder_offset_minutes != null
        ? new Date(
            Date.parse(dueAt) - rule.reminder_offset_minutes * 60_000,
          ).toISOString()
        : null;
    const title =
      (rule.title_template ?? "Новая заявка")
        .replaceAll("{{name}}", effectiveName)
        .replaceAll("{{email}}", effectiveEmail)
        .replaceAll("{{phone}}", effectivePhone ?? "") || "Новая заявка";
    const description = (rule.description_template ?? "")
      .replaceAll("{{name}}", effectiveName)
      .replaceAll("{{email}}", effectiveEmail)
      .replaceAll("{{phone}}", effectivePhone ?? "")
      .replaceAll("{{comment}}", comment ?? "");

    const { data: task, error: taskErr } = await supa
      .from("crm_tasks")
      .insert({
        workspace_id: SYSTEM_WORKSPACE_ID,
        task_type_id: rule.task_type_id,
        title,
        description,
        contact_id: profileId,
        deal_id: orderId,
        order_id: orderId,
        pipeline_id: routing?.pipeline_id ?? null,
        pipeline_stage_id: routing?.stage_on_pending ?? null,
        offer_id,
        product_id: productId,
        tariff_id: offer.tariff_id,
        assignee_user_id: rule.assignee_user_id,
        due_at: dueAt,
        remind_at: remindAt,
        status: "open",
        source: "auto",
        automation_rule_id: rule.id,
        meta: {
          origin: "lead_form",
          order_id: orderId,
          offer_id,
        },
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      console.error("[submit-lead-request] task insert failed", taskErr);
      continue;
    }
    createdTasks.push(task.id);

    const { data: notif } = await supa
      .from("crm_task_notifications")
      .insert({
        task_id: task.id,
        notification_type: "assigned",
        channel: "telegram",
        recipient_user_id: rule.assignee_user_id,
        scheduled_at: new Date().toISOString(),
        status: "pending",
        metadata: {
          origin: "lead_form",
          order_id: orderId,
          offer_id,
        },
      })
      .select("id")
      .single();
    if (notif) createdNotifications.push(notif.id);
  }

  return jsonResponse(
    {
      ok: true,
      order_id: orderId,
      tasks_created: createdTasks.length,
      notifications_scheduled: createdNotifications.length,
    },
    200,
    cors,
  );
});
