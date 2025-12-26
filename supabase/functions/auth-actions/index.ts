import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthActionsRequest {
  action: "reset_password" | "confirm_signup";
  email: string;
}

serve(async (req: Request): Promise<Response> => {
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

    console.log(`Auth action: ${action}, Email: ${email}`);

    switch (action) {
      case "reset_password": {
        // Check if user exists
        const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        
        if (listError) {
          console.error("List users error:", listError);
          // Don't reveal if user exists or not for security
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const userExists = users.users.some(u => u.email?.toLowerCase() === email.toLowerCase());
        
        if (!userExists) {
          // Don't reveal if user exists - just pretend it worked
          console.log("User not found, returning success anyway for security");
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Generate password reset link
        const origin = req.headers.get("origin") || "https://gorbova.by";
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: email,
          options: {
            redirectTo: `${origin}/auth?mode=reset`,
          },
        });

        if (linkError || !linkData?.properties?.hashed_token) {
          console.error("Generate link error:", linkError);
          return new Response(JSON.stringify({ error: "Failed to generate reset link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Build reset link
        const resetLink = `${supabaseUrl}/auth/v1/verify?token=${linkData.properties.hashed_token}&type=recovery&redirect_to=${encodeURIComponent(origin + "/auth?mode=reset")}`;

        // Send email via our custom send-email function
        try {
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
              to: email,
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
                  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
                  <p style="color: #999; font-size: 12px;">С уважением,<br>Команда Gorbova.by</p>
                </div>
              `,
              text: `Вы запросили сброс пароля. Перейдите по ссылке: ${resetLink}`,
            }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json();
            console.error("Email send error:", emailError);
            return new Response(JSON.stringify({ error: "Failed to send email" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          console.log("Password reset email sent to:", email);
        } catch (emailErr) {
          console.error("Email send exception:", emailErr);
          return new Response(JSON.stringify({ error: "Failed to send email" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "confirm_signup": {
        // For future use: custom signup confirmation
        // This would generate a signup confirmation link and send via custom email
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
    console.error("Auth actions error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
