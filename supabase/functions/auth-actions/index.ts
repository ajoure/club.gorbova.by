import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AuthActionsRequest {
  action: "reset_password" | "confirm_signup";
  email: string;
}

/**
 * Find an auth user by email using admin API.
 * Source of truth = auth.users (NOT public.profiles).
 * Uses listUsers with a filter; falls back to scanning the first page.
 */
async function findAuthUserByEmail(supabaseAdmin: any, email: string): Promise<{ id: string; email: string } | null> {
  const normalized = email.toLowerCase().trim();
  try {
    // Supabase admin API: listUsers supports pagination but no direct email filter on all versions.
    // Try first page (default 50 users) — for full coverage we iterate up to a safety cap.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50; // up to 50k users
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
      if (error) {
        console.error(`[findAuthUserByEmail] listUsers page=${page} error:`, error);
        return null;
      }
      const users = data?.users ?? [];
      const found = users.find((u: any) => (u.email || "").toLowerCase() === normalized);
      if (found) return { id: found.id, email: found.email };
      if (users.length < PAGE_SIZE) break; // last page
    }
  } catch (err) {
    console.error("[findAuthUserByEmail] exception:", err);
  }
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
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
        // Source of truth: auth.users (NOT profiles).
        // Profile may be missing for legacy users; reset must still work.
        const authUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);

        if (!authUser) {
          // Privacy-safe: do not reveal if user exists.
          // This is the ONLY case where we silently return success.
          console.log(`[auth-actions] User not found in auth.users — privacy-safe success for ${normalizedEmail}`);
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        console.log(`[auth-actions] Auth user found (id=${authUser.id}), generating recovery link for ${normalizedEmail}`);

        // Generate password recovery link via Supabase admin API.
        const siteUrl = "https://club.gorbova.by";
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: normalizedEmail,
          options: {
            redirectTo: `${siteUrl}/auth?mode=reset`,
          },
        });

        if (linkError || !linkData?.properties?.hashed_token) {
          // Internal error — surface it (not privacy-safe success).
          console.error("[auth-actions] generateLink failed:", linkError);
          return new Response(
            JSON.stringify({ error: "Failed to generate reset link", code: "link_generation_failed" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const resetLink = `${supabaseUrl}/auth/v1/verify?token=${linkData.properties.hashed_token}&type=recovery&redirect_to=${encodeURIComponent(siteUrl + "/auth?mode=reset")}`;

        // Send email via the existing SMTP-backed send-email function.
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              to: normalizedEmail,
              subject: "Сброс пароля",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h1 style="color: #333;">Сброс пароля</h1>
                  <p>Вы запросили сброс пароля для вашего аккаунта.</p>
                  <p>Нажмите на кнопку ниже, чтобы установить новый пароль:</p>
                  <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Сбросить пароль
                  </a>
                  <p style="color: #666; font-size: 14px;">Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
                  <p style="color: #999; font-size: 12px;">Ссылка действительна ограниченное время. Если она не сработает — запросите новую на сайте.</p>
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #999; font-size: 12px;">С уважением,<br>Команда Gorbova.by</p>
                </div>
              `,
              text: `Вы запросили сброс пароля. Перейдите по ссылке: ${resetLink}`,
            }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json().catch(() => ({}));
            console.error("[auth-actions] send-email failed:", emailResponse.status, emailError);
            // Internal failure — must NOT be hidden behind privacy-safe success.
            return new Response(
              JSON.stringify({ error: "Failed to send email", code: "email_send_failed" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log(`[auth-actions] Recovery email dispatched to ${normalizedEmail}`);
        } catch (emailErr) {
          console.error("[auth-actions] send-email exception:", emailErr);
          return new Response(
            JSON.stringify({ error: "Failed to send email", code: "email_send_exception" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "confirm_signup": {
        return new Response(JSON.stringify({ error: "Not implemented" }), {
          status: 501,
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
