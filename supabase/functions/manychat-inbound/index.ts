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
  // Identity of the Instagram user (the contact) — used to resolve contact
  // for BOTH inbound and outbound events.
  subscriber_id: string;
  subscriber_name: string | null;
  avatar_url: string | null;
  // direction === "outbound" for team-member replies coming back from ManyChat.
  direction: "inbound" | "outbound";
  // sender_* describes who authored THIS message. For inbound == subscriber.
  // For outbound == the team member (Katerina / manager name from ManyChat).
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

  // Direction detection: ManyChat may fire an External Request on team-member
  // replies (Live Chat / Instagram app synced via ManyChat). Support a few
  // flag aliases so the Flow author can pick the most convenient one.
  const directionRaw = pickString(body.direction, body.event_type, body.event);
  const isOutbound =
    body.is_outbound === true ||
    body.is_outgoing === true ||
    body.outbound === true ||
    (typeof directionRaw === "string" &&
      /^(outbound|outgoing|team_reply|team_member_reply|agent_reply|admin_reply|message_sent)$/i.test(
        directionRaw,
      ));
  const direction: "inbound" | "outbound" = isOutbound ? "outbound" : "inbound";

  // Subscriber = the Instagram contact. Resolve from subscriber.* first so
  // outbound events (where body.sender_id may be the agent) still link to the
  // right contact.
  const subscriber_id = pickString(
    subscriber?.id,
    subscriber?.user_ref,
    body.subscriber_id,
    body.contact_id,
    body.peer_id,
    // Fall back to top-level sender_id only for inbound events; for outbound
    // the top-level sender_id typically refers to the team member.
    isOutbound ? null : body.sender_id,
    isOutbound ? null : body.user_id,
  );

  if (!subscriber_id) {
    return { error: "missing_subscriber_id" };
  }

  const subscriber_name = pickString(
    subscriber?.name,
    subscriber?.first_name && subscriber?.last_name
      ? `${subscriber.first_name} ${subscriber.last_name}`
      : null,
    subscriber?.first_name,
    subscriber?.username,
    body.subscriber_name,
  );

  const rawText = pickString(
    body.message_text,
    body.text,
    body.message?.text,
    // last_input_text is meaningful only for inbound (user's last message).
    isOutbound ? null : lastInput,
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

  if (!media_url && rawText && isLikelyMediaUrl(rawText)) {
    media_url = rawText;
    message_text = null;
  }

  if (media_url && !media_type) {
    media_type = classifyMediaUrlFast(media_url);
    if (!media_type || media_type === "file") {
      const probed = await probeMimeOptional(media_url);
      if (probed) media_type = probed;
    }
    if (!media_type) media_type = "file";
  }

  let external_message_id = pickString(
    body.message_id,
    body.external_message_id,
    body.mid,
    body.message?.mid,
  );

  if (!external_message_id) {
    const ts = pickString(body.timestamp, body.created_at) ?? String(Date.now());
    external_message_id = `${isOutbound ? "mc_out" : "mc"}:${subscriber_id}:${ts}`;
  } else if (isOutbound && !/^mc_out:/i.test(external_message_id)) {
    // Prefix outbound IDs to guarantee no collision with inbound ones sharing
    // the same UNIQUE(account, external_message_id) index.
    external_message_id = `mc_out:${external_message_id}`;
  }

  // sender_* — author of THIS message.
  let sender_id: string;
  let sender_name: string | null;
  if (isOutbound) {
    sender_id =
      pickString(
        body.agent_id,
        body.team_member_id,
        body.admin_id,
        body.sender_id,
        body.page_id,
        body.manychat_page_id,
      ) || "manychat_team";
    sender_name = pickString(
      body.agent_name,
      body.team_member_name,
      body.admin_name,
      body.sender_name,
      body.full_name,
      body.page?.name,
      body.page_name,
    );
  } else {
    sender_id = subscriber_id;
    sender_name = pickString(
      body.sender_name,
      body.full_name,
      subscriber_name,
    );
  }

  const rawAvatar = pickString(
    subscriber?.profile_pic,
    subscriber?.profile_pic_url,
    body.profile_pic,
    body.avatar_url,
  );
  const avatar_url = rawAvatar && /^https?:\/\//i.test(rawAvatar) ? rawAvatar : null;

  const ig_thread_id = pickString(body.ig_thread_id, body.thread_id);
  const thread_key = pickString(body.thread_key, ig_thread_id, subscriber_id);

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
    subscriber_id,
    subscriber_name,
    avatar_url,
    direction,
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

async function markManyChatIngressHealth(
  supabase: any,
  instanceId: string,
  successful: boolean,
) {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    last_check_at: now,
  };
  if (successful) {
    payload.last_successful_sync_at = now;
    payload.status = "connected";
    payload.error_message = null;
  }
  try {
    const { error } = await supabase
      .from("integration_instances")
      .update(payload)
      .eq("id", instanceId);
    if (error) console.error("[manychat-inbound] health_update_failed", error.message);
  } catch (e) {
    console.error("[manychat-inbound] health_update_failed", e);
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

  // A correctly authenticated request proves that ManyChat reached our edge.
  // It is distinct from a successful message persistence watermark below.
  await markManyChatIngressHealth(supabase, instance.id, false);

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
  // Avatar: пишем только если получили валидный URL (никогда не перетираем на null).
  // PATCH: если webhook payload не содержит profile_pic, делаем pull через /fb/subscriber/getInfo.
  let resolvedAvatar: string | null = normalized.avatar_url;
  if (!resolvedAvatar) {
    const apiKey =
      (instance.config_secrets?.api_key as string | undefined) ||
      Deno.env.get("MANYCHAT_API_TOKEN") ||
      null;
    if (apiKey) {
      try {
        const subIdNum = /^\d+$/.test(String(normalized.subscriber_id))
          ? Number(normalized.subscriber_id)
          : normalized.subscriber_id;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const resp = await fetch(
          `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(String(subIdNum))}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctrl.signal,
          },
        );
        clearTimeout(t);
        if (resp.ok) {
          const j: any = await resp.json().catch(() => null);
          const pic = j?.data?.profile_pic ?? j?.data?.profile_pic_url ?? null;
          if (typeof pic === "string" && /^https?:\/\//i.test(pic)) {
            resolvedAvatar = pic;
          }
        } else {
          console.warn("[manychat-inbound] avatar_pull_non_ok", resp.status);
        }
      } catch (e) {
        console.warn("[manychat-inbound] avatar_pull_failed", e);
      }
    }
  }

  try {
    const contactPayload: Record<string, unknown> = {
      instagram_account_id: accountId!,
      instagram_user_id: normalized.subscriber_id,
      instagram_username: normalized.subscriber_name,
      full_name: normalized.subscriber_name,
      provider_kind: "manychat",
      updated_at: new Date().toISOString(),
    };
    if (resolvedAvatar) {
      contactPayload.avatar_url = resolvedAvatar;
    }
    await supabase
      .from("instagram_contacts")
      .upsert(contactPayload, {
        onConflict: "instagram_account_id,provider_kind,instagram_user_id",
      });
  } catch (e) {
    console.error("[manychat-inbound] contact_upsert_failed", e);
    // non-fatal
  }

  // 7) Insert message with idempotency on UNIQUE(account_id, external_message_id)
  // peer_id is always the Instagram contact (subscriber), regardless of direction —
  // that's how the inbox groups messages into a dialog.
  const { error: msgErr, data: inserted } = await supabase
    .from("instagram_messages")
    .insert({
      instagram_account_id: accountId!,
      external_message_id: normalized.external_message_id,
      provider_message_id: normalized.external_message_id,
      sender_id: normalized.sender_id,
      sender_name: normalized.sender_name,
      peer_id: normalized.subscriber_id,
      recipient_id: normalized.direction === "outbound" ? normalized.subscriber_id : null,
      ig_thread_id: normalized.ig_thread_id,
      thread_key: normalized.thread_key,
      direction: normalized.direction,
      message_text: normalized.message_text,
      media_url: normalized.media_url,
      media_type: normalized.media_type,
      raw_payload: rawBody,
      is_read: normalized.direction === "outbound" ? true : false,
      provider_kind: "manychat",
      status: normalized.direction === "outbound" ? "sent" : "received",
    })
    .select("id")
    .maybeSingle();


  if (msgErr) {
    // Soft-dedup on unique violation
    const isDup =
      msgErr.code === "23505" ||
      (msgErr.message ?? "").includes("duplicate key");
    if (isDup) {
      await markManyChatIngressHealth(supabase, instance.id, true);
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

  // 8b) Push notifications to admins (only for incoming client messages, not dedupe path).
  // Fire-and-forget: never break the 200 OK to ManyChat.
  if (normalized.direction === "inbound" && inserted?.id) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Resolve display name: prefer linked platform profile, fallback to IG username.
      let senderName = normalized.subscriber_name || "Сообщение из Instagram";
      let source = "ig_subscriber_name";
      try {
        const { data: contact } = await supabase
          .from("instagram_contacts")
          .select("profile_id, instagram_username, full_name")
          .eq("instagram_account_id", accountId!)
          .eq("provider_kind", "manychat")
          .eq("instagram_user_id", normalized.subscriber_id)
          .maybeSingle();

        if (contact?.profile_id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("first_name, last_name, full_name")
            .eq("id", contact.profile_id)
            .maybeSingle();
          const last = (prof?.last_name || "").trim();
          const first = (prof?.first_name || "").trim();
          const full = (prof?.full_name || "").trim();
          if (last && first) { senderName = `${last} ${first}`; source = "platform_first_last"; }
          else if (last) { senderName = last; source = "platform_last"; }
          else if (first) { senderName = first; source = "platform_first"; }
          else if (full) { senderName = full; source = "platform_full"; }
        } else if (contact?.instagram_username) {
          senderName = `@${contact.instagram_username}`;
          source = "ig_username";
        }
      } catch (nameErr) {
        console.warn("[manychat-inbound][push] name_resolve_failed", nameErr);
      }

      const preview = ((normalized.message_text || "").trim()
        || (normalized.media_url ? "[медиа]" : "Новое сообщение"))
        .slice(0, 100);

      console.log("[Push][instagram] resolved name", JSON.stringify({
        source,
        account_id: accountId,
        subscriber_id: normalized.subscriber_id,
      }));

      // Fetch admin user_ids (super_admin + admin), mirror telegram-webhook.
      const { data: adminRoles } = await supabase
        .from("user_roles_v2")
        .select("user_id, roles!inner(code)")
        .in("roles.code", ["super_admin", "admin"]);
      const adminUserIds = Array.from(
        new Set(((adminRoles as any[]) || []).map((r) => r.user_id).filter(Boolean)),
      );

      if (adminUserIds.length > 0) {
        fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            user_ids: adminUserIds,
            title: `📷 ${senderName}`,
            body: preview,
            url: "/admin/communication",
            tag: `ig-msg-${accountId}-${normalized.subscriber_id}`,
          }),
        }).catch((e) => console.error("[Push][instagram] send error", e));
      }
    } catch (pushErr) {
      console.error("[manychat-inbound][push] error", pushErr);
    }
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
  await markManyChatIngressHealth(supabase, instance.id, true);

  return jsonResponse({
    success: true,
    message_id: inserted?.id,
    deduped: false,
  });
});
