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

  // The database performs the checks, revocation, and insert under advisory
  // locks. Splitting those steps in this public function lets simultaneous
  // requests both pass the old SELECT-based rate limits.
  const code = generateOtpCode();
  const salt = generateSalt();
  const codeHash = await hmacOtp(code, salt, pepper);
  const { data: issueRows, error: issueErr } = await supabase.rpc(
    "issue_inline_otp_code",
    {
      p_email: email,
      p_code_hash: codeHash,
      p_salt: salt,
      p_flow_id: flowId,
      p_purpose: purpose,
      p_meta: meta,
      p_ip: ip,
      p_user_agent: ua,
      p_ttl_seconds: TTL_MIN * 60,
    },
  );
  if (issueErr) {
    console.error("[request-inline-otp] atomic issue failed:", issueErr);
    return json({ error: "internal_error" }, 500);
  }
  const issue = Array.isArray(issueRows) ? issueRows[0] : null;
  if (!issue) return json({ error: "internal_error" }, 500);
  if (issue.status === "rate_limited") {
    return json({ error: "rate_limited", retry_after_s: Number(issue.retry_after_s || 60) }, 429);
  }
  if (issue.status !== "issued" || !issue.expires_at) {
    return json({ error: "internal_error" }, 500);
  }
  const expiresAt = String(issue.expires_at);

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
