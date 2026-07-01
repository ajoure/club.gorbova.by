// One-shot campaign: notify users whose password reset emails may not have
// arrived recently that delivery is restored, with a fresh personal recovery
// link (24h). Idempotent by (to_email, template_code) in email_logs.
//
// Auth: super_admin JWT required.
// Body: { emails: string[], dry_run?: boolean }
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { sendViaYandexSmtp } from "../_shared/yandex-smtp-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_NAME = "Gorbova Club";
const ROOT_DOMAIN = "gorbova.by";
const SITE_URL = `https://club.${ROOT_DOMAIN}`;
const FROM_EMAIL = "noreply@gorbova.by";
const TEMPLATE_CODE = "password_reset_recovery_notice_2026_07";
const SUBJECT = "Сброс пароля восстановлен — установите новый пароль";

async function getYandexPassword(supabase: any): Promise<string> {
  try {
    const { data: integrations } = await supabase
      .from("integration_instances")
      .select("config, config_secrets, status")
      .eq("category", "email");
    for (const row of integrations ?? []) {
      const cfg = (row?.config || {}) as Record<string, unknown>;
      const secrets = (row?.config_secrets || {}) as Record<string, unknown>;
      const email = (cfg.email as string) || (cfg.from_email as string) || "";
      if (email !== FROM_EMAIL) continue;
      const pwd =
        (secrets.smtp_password as string) ||
        (secrets.password as string) ||
        (cfg.smtp_password as string) ||
        (cfg.password as string) ||
        "";
      if (pwd) return pwd;
    }
  } catch (_) { /* ignore */ }
  try {
    const { data: acc } = await supabase
      .from("email_accounts")
      .select("smtp_password")
      .eq("email", FROM_EMAIL)
      .maybeSingle();
    if (acc?.smtp_password) return acc.smtp_password;
  } catch (_) { /* ignore */ }
  const envPwd = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  if (envPwd) return envPwd;
  throw new Error("Yandex SMTP password is not configured");
}

function rewriteHostToRoot(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.host = ROOT_DOMAIN;
    return u.toString();
  } catch {
    return url;
  }
}

function buildHtml(link: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;padding:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;max-width:560px;">
      <tr><td style="font-size:16px;line-height:1.5;">
        <p style="margin:0 0 16px;">Здравствуйте!</p>
        <p style="margin:0 0 16px;">Вы недавно запрашивали сброс пароля на платформе gorbova.by.</p>
        <p style="margin:0 0 24px;">Доставка писем восстановления была исправлена. Перейдите по ссылке ниже и установите новый пароль:</p>
        <p style="margin:0 0 24px;text-align:center;">
          <a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">Сбросить пароль</a>
        </p>
        <p style="margin:0 0 16px;font-size:14px;color:#555;">Ссылка действует в течение 24 часов.</p>
        <p style="margin:0 0 16px;font-size:14px;color:#555;">Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
        <p style="margin:24px 0 4px;">Приносим извинения за неудобства.</p>
        <p style="margin:0;">Команда gorbova.by</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function buildText(link: string): string {
  return `Здравствуйте!

Вы недавно запрашивали сброс пароля на платформе gorbova.by.

Доставка писем восстановления была исправлена. Перейдите по ссылке ниже и установите новый пароль:

${link}

Ссылка действует в течение 24 часов.

Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.

Приносим извинения за неудобства.
Команда gorbova.by`;
}

interface Req {
  emails: string[];
  dry_run?: boolean;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // AuthN: super_admin JWT required
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await admin
      .from("user_roles_v2")
      .select("role")
      .eq("user_id", userData.user.id)
      .in("role", ["super_admin"])
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Req;
    const emails = Array.from(new Set((body.emails || []).map((e) => e.toLowerCase().trim()).filter(Boolean)));
    const dryRun = !!body.dry_run;
    if (!emails.length) {
      return new Response(JSON.stringify({ error: "emails required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: skip emails that already have a sent row for this template_code
    const { data: existing } = await admin
      .from("email_logs")
      .select("to_email")
      .eq("template_code", TEMPLATE_CODE)
      .eq("status", "sent")
      .in("to_email", emails);
    const alreadySent = new Set((existing || []).map((r: any) => (r.to_email || "").toLowerCase()));

    const password = dryRun ? "" : await getYandexPassword(admin);
    const results: Array<Record<string, unknown>> = [];

    for (const email of emails) {
      if (alreadySent.has(email)) {
        results.push({ email, status: "skipped_already_sent" });
        continue;
      }
      try {
        const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${SITE_URL}/auth?mode=reset` },
        });
        if (linkError || !linkData?.properties?.action_link) {
          results.push({ email, status: "no_auth_user_or_link_failed", error: linkError?.message });
          continue;
        }
        const link = rewriteHostToRoot(linkData.properties.action_link);
        const html = buildHtml(link);
        const text = buildText(link);

        if (dryRun) {
          results.push({ email, status: "dry_run_link_ready", link_preview: link.slice(0, 60) + "..." });
          continue;
        }

        await sendViaYandexSmtp({
          to: email,
          subject: SUBJECT,
          html,
          text,
          fromName: SITE_NAME,
          fromEmail: FROM_EMAIL,
          username: FROM_EMAIL,
          password,
        });
        await admin.from("email_logs").insert({
          direction: "outgoing",
          from_email: FROM_EMAIL,
          to_email: email,
          subject: SUBJECT,
          body_html: html,
          body_text: text,
          template_code: TEMPLATE_CODE,
          provider: "yandex_smtp",
          status: "sent",
          meta: { source: "oneshot-password-reset-notice-2026-07", campaign: TEMPLATE_CODE },
        });
        results.push({ email, status: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ email, status: "failed", error: msg });
        try {
          await admin.from("email_logs").insert({
            direction: "outgoing",
            from_email: FROM_EMAIL,
            to_email: email,
            subject: SUBJECT,
            template_code: TEMPLATE_CODE,
            provider: "yandex_smtp",
            status: "failed",
            error_message: msg,
            meta: { source: "oneshot-password-reset-notice-2026-07", campaign: TEMPLATE_CODE },
          });
        } catch (_) { /* ignore */ }
      }
    }

    const summary = {
      total: emails.length,
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped_already_sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      no_user: results.filter((r) => r.status === "no_auth_user_or_link_failed").length,
      dry_run: dryRun,
    };
    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[oneshot-password-reset-notice-2026-07] error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
