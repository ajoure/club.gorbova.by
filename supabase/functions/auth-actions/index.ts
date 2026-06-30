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
 */
async function findAuthUserByEmail(supabaseAdmin: any, email: string): Promise<{ id: string; email: string } | null> {
  const normalized = email.toLowerCase().trim();
  try {
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
      if (found) return { id: found.id, email: found.email };
      if (users.length < PAGE_SIZE) break;
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
        // Privacy-safe early exit: do not reveal whether user exists.
        const authUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
        if (!authUser) {
          console.log(`[auth-actions] User not found — privacy-safe success for ${normalizedEmail}`);
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        console.log(`[auth-actions] Auth user found (id=${authUser.id}), invoking resetPasswordForEmail`);

        // CANONICAL recovery path: use built-in resetPasswordForEmail.
        // This routes through Supabase Auth → `auth-email-hook` (configured in
        // hook_send_email) → Lovable email queue. The hook rewrites the
        // Supabase verify URL host to gorbova.by and uses the Russian
        // RecoveryEmail template (see _shared/email-templates/recovery.tsx).
        const siteUrl = "https://club.gorbova.by";
        const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

        const { error: resetError } = await anonClient.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${siteUrl}/auth?mode=reset`,
        });

        if (resetError) {
          console.error("[auth-actions] resetPasswordForEmail failed:", resetError);
          return new Response(
            JSON.stringify({ error: "Failed to send recovery email", code: "email_send_failed" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[auth-actions] Recovery email queued for ${normalizedEmail}`);
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
