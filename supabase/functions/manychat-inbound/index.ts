// ManyChat → Contact Center inbound webhook.
//
// Принимает External Request от ManyChat Flow для каждого нового сообщения
// от пользователя в подключённом Instagram-аккаунте.
//
// Auth: header `X-ManyChat-Token` сверяется с
// integration_instances.config_secrets.webhook_secret.
//
// Routing: instance_id определяется через query param `?instance_id=<uuid>`
// (рекомендуется), иначе — через body field `manychat_page_id`.
//
// Идемпотентность: UNIQUE(instagram_account_id, external_message_id).
// Повторная отправка того же external_message_id — мягкий dedup, 200 OK.
//
// Ничего не пишет в логи, что содержит секреты.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-manychat-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

interface NormalizedInbound {
  external_message_id: string;
  sender_id: string;
  sender_name: string | null;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  ig_thread_id: string | null;
  thread_key: string | null;
  manychat_page_id: string | null;
  manychat_page_name: string | null;
}

// Классификация media URL по домену/расширению (быстрая, без сетевых вызовов).
function classifyMediaUrlFast(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const lower = url.toLowerCase();
  const isFbCdn = /lookaside\.fbsbx\.com|scontent[\w.-]*\.fbcdn\.net|cdninstagram\.com/i.test(url);

  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)(?:[?#]|$)/i.test(lower)) return 'image';
  if (/\.(mp4|mov|webm|m4v|3gp)(?:[?#]|$)/i.test(lower)) return 'video';
  if (/\.(mp3|m4a|ogg|oga|opus|wav|aac|flac)(?:[?#]|$)/i.test(lower)) return 'audio';
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv)(?:[?#]|$)/i.test(lower)) return 'file';

  if (/asset_type=(image|photo)/i.test(url)) return 'image';
  if (/asset_type=(video|reel)/i.test(url)) return 'video';
  if (/asset_type=(audio|voice)/i.test(url)) return 'audio';
  if (/ig_messaging_cdn/i.test(url) && isFbCdn) return 'image'; // IG msg CDN без extension — обычно фото

  if (isFbCdn) return 'file';
  return null;
}

// Optional HEAD enrichment, не блокирующий — fallback по URL pattern всегда применяется.
async function probeMimeOptional(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type');
    if (!ct) return null;
    const main = ct.split(';')[0].trim().toLowerCase();
    if (main.startsWith('image/')) return 'image';
    if (main.startsWith('video/')) return 'video';
    if (main.startsWith('audio/')) return 'audio';
    if (main === 'application/pdf') return 'file';
    return null;
  } catch {
    return null;
  }
}

function isLikelyMediaUrl(s: string): boolean {
  if (!s) return false;
  return /^https?:\/\/(lookaside\.fbsbx\.com|scontent[\w.-]*\.fbcdn\.net|cdninstagram\.com)/i.test(s) ||
         /^https?:\/\/\S+\.(jpe?g|png|gif|webp|mp4|mov|webm|mp3|m4a|ogg|wav|pdf|docx?|xlsx?|pptx?|zip)(?:[?#]|$)/i.test(s);
}

/**
 * Normalize ManyChat External Request body.
 */
async function normalizePayload(body: any): Promise<NormalizedInbound | { error: string }> {
  if (!body || typeof body !== "object") {
    return { error: "empty_or_invalid_body" };
  }

  const subscriber = body.subscriber || body.user || {};
  const lastInput = body.last_input_text ?? body.last_user_input ?? null;

  const sender_id = pickString(
    body.sender_id,
    body.user_id,
    body.subscriber_id,
    subscriber?.id,
    subscriber?.user_ref,
    body.peer_id,
  );

  if (!sender_id) {
    return { error: "missing_sender_id" };
  }

  const rawText = pickString(
    body.message_text,
    body.text,
    lastInput,
    body.message?.text,
  );

  let media_url = pickString(
    body.media_url,
    body.attachment_url,
    body.message?.attachments?.[0]?.payload?.url,
  );

  let media_type = pickString(
    body.media_type,
    body.message?.attachments?.[0]?.type,
  );

  let message_text: string | null = rawText;

  // P1: если media_url не пришёл явно, но last_input_text — это URL вложения (lookaside/cdn),
  // лечим: text → media_url, message_text=null (media-only сообщение).
  if (!media_url && rawText && isLikelyMediaUrl(rawText)) {
    media_url = rawText;
    message_text = null;
  }

  // Классификация: быстрый pattern → optional HEAD enrichment.
  if (media_url && !media_type) {
    media_type = classifyMediaUrlFast(media_url);
    if (!media_type || media_type === 'file') {
      const probed = await probeMimeOptional(media_url);
      if (probed) media_type = probed;
    }
    if (!media_type) media_type = 'file';
  }

  let external_message_id = pickString(
    body.message_id,
    body.external_message_id,
    body.mid,
    body.message?.mid,
  );

  if (!external_message_id) {
    const ts = pickString(body.timestamp, body.created_at) ?? String(Date.now());
    external_message_id = `mc:${sender_id}:${ts}`;
  }

  const sender_name = pickString(
    body.sender_name,
    body.full_name,
    subscriber?.name,
    subscriber?.first_name && subscriber?.last_name
      ? `${subscriber.first_name} ${subscriber.last_name}`
      : null,
    subscriber?.first_name,
    subscriber?.username,
  );

  const ig_thread_id = pickString(body.ig_thread_id, body.thread_id);
  const thread_key = pickString(body.thread_key, ig_thread_id, sender_id);

  const manychat_page_id = pickString(
    body.manychat_page_id,
    body.page_id,
    body.instance_id,
  );

  const manychat_page_name = pickString(
    body.page?.name,
    body.account?.name,
    body.page_name,
    body.account_name,
  );

  return {
    external_message_id,
    sender_id,
    sender_name,
    message_text,
    media_url,
    media_type,
    ig_thread_id,
    thread_key,
    manychat_page_id,
    manychat_page_name,
  };
}

async function logIntegrationEvent(
  supabase: any,
  instance_id: string | null,
  event_type: string,
  outcome: "ok" | "unauthorized" | "duplicate" | "error",
  payload_meta: Record<string, unknown>,
  error_message: string | null = null,
) {
  // integration_logs.result CHECK allows only ('success','error','pending')
  const result = outcome === "error" || outcome === "unauthorized"
    ? "error"
    : "success";
  try {
    const { error } = await supabase.from("integration_logs").insert({
      instance_id,
      event_type,
      result,
      error_message,
      payload_meta: { ...payload_meta, outcome },
    });
    if (error) console.error("[manychat-inbound] log_failed", error.message);
  } catch (e) {
    console.error("[manychat-inbound] log_failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Auth via shared secret
  const providedToken =
    req.headers.get("x-manychat-token") ||
    req.headers.get("X-ManyChat-Token") ||
    "";

  // 2) Parse body once (need page_id to resolve instance)
  let rawBody: any = null;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "invalid_json" }, 400);
  }

  const normalized = await normalizePayload(rawBody);
  if ("error" in normalized) {
    return jsonResponse(
      { success: false, error: normalized.error },
      400,
    );
  }

  // 3) Resolve integration instance
  // Priority: ?instance_id=... > body.manychat_page_id > body.instance_id
  const url = new URL(req.url);
  const instanceIdQuery = url.searchParams.get("instance_id");
  const pageIdHint = normalized.manychat_page_id;

  let instance: any = null;
  if (instanceIdQuery) {
    const { data } = await supabase
      .from("integration_instances")
      .select("id, status, config, config_secrets, provider")
      .eq("id", instanceIdQuery)
      .eq("provider", "manychat")
      .maybeSingle();
    instance = data;
  } else if (pageIdHint) {
    const { data } = await supabase
      .from("integration_instances")
      .select("id, status, config, config_secrets, provider")
      .eq("provider", "manychat")
      .eq("config->>manychat_page_id", pageIdHint)
      .maybeSingle();
    instance = data;
  }

  if (!instance) {
    await logIntegrationEvent(
      supabase,
      null,
      "manychat.external_request",
      "error",
      {
        reason: "instance_not_resolved",
        instance_id_query: instanceIdQuery,
        page_id_hint: pageIdHint,
      },
      "instance_not_resolved",
    );
    return jsonResponse(
      { success: false, error: "instance_not_found" },
      404,
    );
  }

  // 4) Verify shared secret
  const expected = instance.config_secrets?.webhook_secret as
    | string
    | undefined;
  if (!expected || !providedToken || providedToken !== expected) {
    await logIntegrationEvent(
      supabase,
      instance.id,
      "manychat.external_request",
      "unauthorized",
      {
        reason: "invalid_token",
        has_expected: !!expected,
        has_provided: !!providedToken,
      },
      "invalid_token",
    );
    return jsonResponse({ success: false, error: "unauthorized" }, 401);
  }

  // 4.5) P3: backfill manychat_page_name в config, если payload его содержит, но его ещё нет.
  if (normalized.manychat_page_name && !instance.config?.manychat_page_name) {
    try {
      await supabase
        .from('integration_instances')
        .update({ config: { ...(instance.config || {}), manychat_page_name: normalized.manychat_page_name } })
        .eq('id', instance.id);
    } catch (e) {
      console.error('[manychat-inbound] page_name_update_failed', e);
    }
  }

  // 5) Resolve / create instagram_account for this ManyChat instance
  let accountId: string | null = null;
  {
    const { data: acc } = await supabase
      .from("instagram_accounts")
      .select("id")
      .eq("integration_instance_id", instance.id)
      .eq("provider_kind", "manychat")
      .maybeSingle();

    if (acc) {
      accountId = acc.id;
    } else {
      const { data: newAcc, error: accErr } = await supabase
        .from("instagram_accounts")
        .insert({
          integration_instance_id: instance.id,
          provider_kind: "manychat",
          instagram_page_id:
            (instance.config?.manychat_page_id as string) ||
            `mc:${instance.id}`,
          is_active: true,
          status: "connected",
        })
        .select("id")
        .single();
      if (accErr) {
        await logIntegrationEvent(
          supabase,
          instance.id,
          "manychat.external_request",
          "error",
          { reason: "account_create_failed" },
          accErr.message,
        );
        return jsonResponse(
          { success: false, error: "account_create_failed" },
          500,
        );
      }
      accountId = newAcc.id;
    }
  }

  // 6) Upsert contact (provider_kind='manychat')
  try {
    await supabase
      .from("instagram_contacts")
      .upsert(
        {
          instagram_account_id: accountId!,
          instagram_user_id: normalized.sender_id,
          instagram_username: normalized.sender_name,
          full_name: normalized.sender_name,
          provider_kind: "manychat",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "instagram_account_id,provider_kind,instagram_user_id",
        },
      );
  } catch (e) {
    console.error("[manychat-inbound] contact_upsert_failed", e);
    // non-fatal
  }

  // 7) Insert message with idempotency on UNIQUE(account_id, external_message_id)
  const { error: msgErr, data: inserted } = await supabase
    .from("instagram_messages")
    .insert({
      instagram_account_id: accountId!,
      external_message_id: normalized.external_message_id,
      provider_message_id: normalized.external_message_id,
      sender_id: normalized.sender_id,
      sender_name: normalized.sender_name,
      peer_id: normalized.sender_id,
      ig_thread_id: normalized.ig_thread_id,
      thread_key: normalized.thread_key,
      direction: "inbound",
      message_text: normalized.message_text,
      media_url: normalized.media_url,
      media_type: normalized.media_type,
      raw_payload: rawBody,
      is_read: false,
      provider_kind: "manychat",
      status: "received",
    })
    .select("id")
    .maybeSingle();

  if (msgErr) {
    // Soft-dedup on unique violation
    const isDup =
      msgErr.code === "23505" ||
      (msgErr.message ?? "").includes("duplicate key");
    if (isDup) {
      await logIntegrationEvent(
        supabase,
        instance.id,
        "manychat.external_request",
        "duplicate",
        {
          external_message_id: normalized.external_message_id,
          sender_id: normalized.sender_id,
        },
      );
      return jsonResponse({ success: true, deduped: true });
    }
    await logIntegrationEvent(
      supabase,
      instance.id,
      "manychat.external_request",
      "error",
      { reason: "insert_failed", code: msgErr.code },
      msgErr.message,
    );
    return jsonResponse(
      { success: false, error: "insert_failed", details: msgErr.message },
      500,
    );
  }

  // 8) Best-effort domain event (non-fatal)
  try {
    await supabase.from("domain_events").insert({
      event_type: "manychat.message.inbound.v1",
      source: "manychat-inbound",
      entity_id: inserted?.id || accountId!,
      payload: {
        instance_id: instance.id,
        instagram_account_id: accountId,
        external_message_id: normalized.external_message_id,
        sender_id: normalized.sender_id,
        has_text: !!normalized.message_text,
        has_media: !!normalized.media_url,
      },
    });
  } catch (e) {
    console.error("[manychat-inbound] domain_event_failed", e);
  }

  await logIntegrationEvent(
    supabase,
    instance.id,
    "manychat.external_request",
    "ok",
    {
      message_id: inserted?.id,
      external_message_id: normalized.external_message_id,
      sender_id: normalized.sender_id,
      has_text: !!normalized.message_text,
      has_media: !!normalized.media_url,
    },
  );

  return jsonResponse({
    success: true,
    message_id: inserted?.id,
    deduped: false,
  });
});
