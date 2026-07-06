// request-inline-otp
// Собственный OTP-канал в обход GoTrue Send Email Hook.
// - Генерирует 6-значный код, хранит HMAC(code, salt, INLINE_OTP_PEPPER).
// - Отправляет письмо через существующий Yandex SMTP (noreply@gorbova.by).
// - Rate-limit по email и IP.
// - Публичный endpoint (verify_jwt=false), защищён hash+TTL+rate-limit.

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendViaYandexSmtp } from "../_shared/yandex-smtp-sender.ts";
import { renderInlineOtpEmail } from "../_shared/inline-otp-email-template.ts";
import {
  generateOtpCode,
  generateSalt,
  getClientIp,
  hmacOtp,
} from "../_shared/inline-otp-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM_EMAIL = "noreply@gorbova.by";
const FROM_NAME = "Екатерина Горбова";
const TTL_MIN = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PURPOSE_ALLOWED = new Set(["lead", "payment", "invoice", "auth", "generic"]);

interface RequestBody {
  email?: string;
  purpose?: string;
  flowId?: string | null;
  meta?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    phone?: string;
  } | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const pepper = Deno.env.get("INLINE_OTP_PEPPER") || "";
  if (!pepper) {
    console.error("[request-inline-otp] INLINE_OTP_PEPPER not set");
    return json({ error: "server_misconfigured" }, 500);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = (body.email || "").toString().trim().toLowerCase();
  const purpose = (body.purpose || "generic").toString();
  const flowId = body.flowId ? String(body.flowId).slice(0, 128) : null;

  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
  if (email.length > 320) return json({ error: "invalid_email" }, 400);
  if (!PURPOSE_ALLOWED.has(purpose)) return json({ error: "invalid_purpose" }, 400);

  const meta = {
    firstName: body.meta?.firstName ? String(body.meta.firstName).slice(0, 128) : undefined,
    lastName: body.meta?.lastName ? String(body.meta.lastName).slice(0, 128) : undefined,
    fullName: body.meta?.fullName ? String(body.meta.fullName).slice(0, 256) : undefined,
    phone: body.meta?.phone ? String(body.meta.phone).slice(0, 64) : undefined,
  };

  const ip = getClientIp(req);
  const ua = (req.headers.get("user-agent") || "").slice(0, 512);
  const nowIso = new Date().toISOString();

  // ----- Rate limits -----
  // 1 письмо / 60 сек на email
  const { data: lastRow } = await supabase
    .from("inline_otp_codes")
    .select("last_send_at")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRow?.last_send_at) {
    const delta = Date.now() - new Date(lastRow.last_send_at).getTime();
    if (delta < 60_000) {
      return json({ error: "rate_limited", retry_after_s: Math.ceil((60_000 - delta) / 1000) }, 429);
    }
  }

  // 5 писем / час на email
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: emailHourCount } = await supabase
    .from("inline_otp_codes")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", oneHourAgo);
  if ((emailHourCount || 0) >= 5) {
    return json({ error: "rate_limited", retry_after_s: 900 }, 429);
  }

  // 20 писем / час на IP
  if (ip) {
    const { count: ipHourCount } = await supabase
      .from("inline_otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", oneHourAgo);
    if ((ipHourCount || 0) >= 20) {
      return json({ error: "rate_limited", retry_after_s: 900 }, 429);
    }
  }

  // ----- Revoke previous unused codes for this email/purpose -----
  await supabase
    .from("inline_otp_codes")
    .update({ revoked_at: nowIso })
    .eq("email", email)
    .is("used_at", null)
    .is("revoked_at", null);

  // ----- Generate + store -----
  const code = generateOtpCode();
  const salt = generateSalt();
  const codeHash = await hmacOtp(code, salt, pepper);
  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000).toISOString();

  const { error: insertErr } = await supabase.from("inline_otp_codes").insert({
    email,
    code_hash: codeHash,
    salt,
    flow_id: flowId,
    purpose,
    meta,
    ip,
    user_agent: ua,
    expires_at: expiresAt,
    last_send_at: nowIso,
  });
  if (insertErr) {
    console.error("[request-inline-otp] insert failed:", insertErr);
    return json({ error: "internal_error" }, 500);
  }

  // ----- Send email via Yandex SMTP -----
  const smtpPassword = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  if (!smtpPassword) {
    console.error("[request-inline-otp] YANDEX_SMTP_PASSWORD not set");
    return json({ error: "smtp_not_configured" }, 500);
  }

  const { subject, html, text } = renderInlineOtpEmail({ code, ttlMinutes: TTL_MIN });

  try {
    await sendViaYandexSmtp({
      to: email,
      subject,
      html,
      text,
      fromName: FROM_NAME,
      fromEmail: FROM_EMAIL,
      username: FROM_EMAIL,
      password: smtpPassword,
    });
  } catch (e) {
    console.error("[request-inline-otp] smtp send failed:", (e as Error).message);
    return json({ error: "smtp_send_failed" }, 502);
  }

  // Best-effort audit log (non-blocking).
  try {
    await supabase.from("email_send_log").insert({
      message_id: crypto.randomUUID(),
      recipient: email,
      template_name: "inline_otp",
      subject,
      status: "sent",
      metadata: { purpose, flow_id: flowId },
    });
  } catch (_) {
    // email_send_log may not exist yet — ignore.
  }

  return json({ ok: true, expires_at: expiresAt, ttl_seconds: TTL_MIN * 60 });
});
