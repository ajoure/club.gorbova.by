import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { RecoveryEmail } from "../_shared/email-templates/recovery.tsx";
import { SignupEmail } from "../_shared/email-templates/signup.tsx";
import { sendViaYandexSmtp } from "../_shared/yandex-smtp-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_NAME = "Gorbova Club";
const ROOT_DOMAIN = "gorbova.by";
const SITE_URL = `https://club.${ROOT_DOMAIN}`;
const FROM_EMAIL = "noreply@gorbova.by";
const SMTP_HOST = "smtp.yandex.ru";
const SMTP_PORT = 465;

interface AuthActionsRequest {
  action: "reset_password" | "confirm_signup";
  email: string;
}

/**
 * Resolve Yandex SMTP password. Priority:
 *   1. integration_instances(category=email, config.email=noreply@gorbova.by, status=connected)
 *   2. email_accounts.smtp_password
 *   3. env YANDEX_SMTP_PASSWORD
 */
async function getYandexPassword(supabase: any): Promise<string> {
  try {
    const { data: integrations } = await supabase
      .from("integration_instances")
      .select("config, config_secrets, status")
      .eq("category", "email");
    if (Array.isArray(integrations)) {
      for (const row of integrations) {
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
    }
  } catch (err) {
    console.warn("[auth-actions] integration_instances lookup failed:", err);
  }

  try {
    const { data: acc } = await supabase
      .from("email_accounts")
      .select("smtp_password")
      .eq("email", FROM_EMAIL)
      .maybeSingle();
    if (acc?.smtp_password) return acc.smtp_password;
  } catch (err) {
    console.warn("[auth-actions] email_accounts lookup failed:", err);
  }

  const envPwd = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  if (envPwd) return envPwd;

  throw new Error("Yandex SMTP password is not configured");
}

/**
 * Locate an auth user by email using admin API. Source of truth is auth.users.
 */
async function findAuthUserByEmail(
  supabaseAdmin: any,
  email: string,
): Promise<{ id: string; email: string; email_confirmed_at: string | null } | null> {
  const normalized = email.toLowerCase().trim();
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      console.error(`[findAuthUserByEmail] listUsers page=${page} error:`, error);
      return null;
    }
    const users = data?.users ?? [];
    const found = users.find((u: any) => (u.email || "").toLowerCase() === normalized);
    if (found) return { id: found.id, email: found.email, email_confirmed_at: found.email_confirmed_at ?? null };
    if (users.length < PAGE_SIZE) break;
  }
  return null;
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

async function logEmail(
  supabase: any,
  params: { to: string; subject: string; html: string; text: string; source: string },
) {
  try {
    await supabase.from("email_logs").insert({
      direction: "outgoing",
      from_email: FROM_EMAIL,
      to_email: params.to,
      subject: params.subject,
      body_html: params.html,
      body_text: params.text || null,
      provider: "yandex_smtp",
      status: "sent",
      meta: { source: params.source },
    });
  } catch (err) {
    console.warn("[auth-actions] email_logs insert failed", err);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { action, email }: AuthActionsRequest = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`[auth-actions] action=${action} email=${normalizedEmail}`);

    switch (action) {
      case "reset_password": {
        const authUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
        // Privacy: always return success even if user is missing.
        if (!authUser) {
          console.log(`[auth-actions] User not found — privacy-safe success for ${normalizedEmail}`);
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Generate a real recovery link via admin API, then deliver it ourselves
        // via Yandex SMTP. We do NOT rely on Supabase's built-in mailer because
        // the auth-send-email hook is not wired at the project level, which
        // caused the previous mass "не приходит письмо сброса" incident.
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: normalizedEmail,
          options: { redirectTo: `${SITE_URL}/auth?mode=reset` },
        });
        if (linkError || !linkData?.properties?.action_link) {
          console.error("[auth-actions] generateLink recovery failed:", linkError);
          return new Response(
            JSON.stringify({ error: "Failed to generate recovery link", code: "generate_link_failed" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const confirmationUrl = rewriteHostToRoot(linkData.properties.action_link);
        const html = await renderAsync(
          React.createElement(RecoveryEmail, { siteName: SITE_NAME, confirmationUrl }),
        );
        const text = await renderAsync(
          React.createElement(RecoveryEmail, { siteName: SITE_NAME, confirmationUrl }),
          { plainText: true },
        );

        try {
          const password = await getYandexPassword(supabaseAdmin);
          await sendViaYandexSmtp({
            to: normalizedEmail,
            subject: "Восстановление пароля",
            html,
            text,
            fromName: SITE_NAME,
            fromEmail: FROM_EMAIL,
            smtpHost: SMTP_HOST,
            smtpPort: SMTP_PORT,
            username: FROM_EMAIL,
            password,
          });
          await logEmail(supabaseAdmin, {
            to: normalizedEmail,
            subject: "Восстановление пароля",
            html,
            text,
            source: "auth-actions:reset_password",
          });
          console.log(`[auth-actions] Recovery email delivered via Yandex SMTP to ${normalizedEmail}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[auth-actions] Yandex SMTP send failed:", msg);
          return new Response(
            JSON.stringify({ error: "Failed to send recovery email", detail: msg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "confirm_signup": {
        const authUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
        if (!authUser) {
          // Privacy-safe: user does not exist. Return success without leaking info.
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (authUser.email_confirmed_at) {
          // Already confirmed — nothing to do.
          return new Response(JSON.stringify({ success: true, alreadyConfirmed: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "signup",
          email: normalizedEmail,
          options: { redirectTo: `${SITE_URL}/auth?mode=confirmed` },
        });
        if (linkError || !linkData?.properties?.action_link) {
          console.error("[auth-actions] generateLink signup failed:", linkError);
          return new Response(
            JSON.stringify({ error: "Failed to generate confirmation link", code: "generate_link_failed" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const confirmationUrl = rewriteHostToRoot(linkData.properties.action_link);

        const html = await renderAsync(
          React.createElement(SignupEmail, {
            siteName: SITE_NAME,
            siteUrl: SITE_URL,
            recipient: normalizedEmail,
            confirmationUrl,
          }),
        );
        const text = await renderAsync(
          React.createElement(SignupEmail, {
            siteName: SITE_NAME,
            siteUrl: SITE_URL,
            recipient: normalizedEmail,
            confirmationUrl,
          }),
          { plainText: true },
        );

        try {
          const password = await getYandexPassword(supabaseAdmin);
          await sendViaYandexSmtp({
            to: normalizedEmail,
            subject: "Подтверждение почты",
            html,
            text,
            fromName: SITE_NAME,
            fromEmail: FROM_EMAIL,
            smtpHost: SMTP_HOST,
            smtpPort: SMTP_PORT,
            username: FROM_EMAIL,
            password,
          });
          await logEmail(supabaseAdmin, {
            to: normalizedEmail,
            subject: "Подтверждение почты",
            html,
            text,
            source: "auth-actions:confirm_signup",
          });
          console.log(`[auth-actions] Signup confirmation delivered via Yandex SMTP to ${normalizedEmail}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[auth-actions] Yandex SMTP send failed:", msg);
          return new Response(
            JSON.stringify({ error: "Failed to send confirmation email", detail: msg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error: any) {
    console.error("[auth-actions] unexpected error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
