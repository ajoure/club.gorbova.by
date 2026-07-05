// deno-lint-ignore-file no-explicit-any
// Public endpoint: submit a lead request from a product page or a SitePage ButtonSection.
// - No JWT required (verify_jwt=false is Lovable Cloud default).
// - Writes a lead-only row into public.orders_v2 (status='lead', amount=0).
// - Creates crm_tasks + crm_task_notifications from crm_task_automation_rules of the offer.
// - Never touches payments_v2 / entitlements / subscriptions_v2 / access_grant_ledger.
// - Never calls bePaid / Stripe / any acquirer.
// - Never creates auth.users.

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
  name: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^\d+]/g, ""))
    .refine((v) => /^\+?\d{5,20}$/.test(v), "invalid phone"),
  email: z.string().trim().toLowerCase().email().max(255),
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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
  const { offer_id, name, phone, email, comment, website, form_opened_at } =
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

  // 2. Profile match (email → phone; conflict → manual_review)
  const { data: emailProfile } = await supa
    .from("profiles")
    .select("id, user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  const { data: phoneProfile } = await supa
    .from("profiles")
    .select("id, user_id")
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

  let profileId: string | null = null;
  let manualReview: Record<string, unknown> | null = null;
  if (emailProfile && phoneProfile && emailProfile.id !== phoneProfile.id) {
    manualReview = {
      reason: "email_phone_mismatch",
      matched_email_profile: emailProfile.id,
      matched_phone_profile: phoneProfile.id,
    };
  } else {
    profileId = emailProfile?.id ?? phoneProfile?.id ?? null;
  }

  // 3. Idempotency window
  const sinceIso = new Date(
    Date.now() - IDEMPOTENCY_WINDOW_MINUTES * 60_000,
  ).toISOString();
  const { data: existing } = await supa
    .from("orders_v2")
    .select("id")
    .eq("offer_id", offer_id)
    .eq("status", "lead")
    .gte("created_at", sinceIso)
    .or(`customer_email.eq.${email},customer_phone.eq.${phone}`)
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
    lead_form: { name, comment: comment ?? null },
    contact_snapshot: { name, email, phone },
    origin: "lead_form",
  };
  if (manualReview) orderMeta.manual_review = manualReview;

  const { data: insertedOrder, error: orderErr } = await supa
    .from("orders_v2")
    .insert({
      order_number: orderNumber,
      offer_id,
      tariff_id: offer.tariff_id,
      product_id: productId,
      profile_id: profileId,
      status: "lead",
      base_price: 0,
      final_price: 0,
      paid_amount: 0,
      currency,
      is_trial: false,
      customer_email: email,
      customer_phone: phone,
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
    // Only fixed_user assignments create real tasks in MVP.
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
        .replaceAll("{{name}}", name)
        .replaceAll("{{email}}", email)
        .replaceAll("{{phone}}", phone) || "Новая заявка";
    const description = (rule.description_template ?? "")
      .replaceAll("{{name}}", name)
      .replaceAll("{{email}}", email)
      .replaceAll("{{phone}}", phone)
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
