import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CheckEmailRequest {
  email: string;
}

interface CheckEmailResponse {
  exists: boolean;
  hasPassword: boolean;
  maskedName?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body: CheckEmailRequest = await req.json();
    const email = body.email?.toLowerCase().trim();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user exists in auth.users via admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    // Get user by email using a more reliable method
    const { data: userData } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, email")
      .eq("email", email)
      .maybeSingle();

    if (!userData) {
      // User doesn't exist
      const response: CheckEmailResponse = {
        exists: false,
        hasPassword: false,
      };
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User exists - check if they have a password set
    // We do this by checking auth.users
    let hasPassword = false;
    let maskedName: string | undefined;

    try {
      const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(
        userData.user_id
      );

      if (authUser?.user) {
        // Check if user has encrypted_password (meaning they have a password)
        // Users created via passwordless methods may not have one
        // For Supabase, if the user was created with email/password signup, they have a password
        // We can check identities or app_metadata
        const identities = authUser.user.identities || [];
        const hasEmailIdentity = identities.some(
          (identity: any) => identity.provider === "email"
        );
        
        // If user has email identity and was not created via magic link only
        // We consider them to have a password
        hasPassword = hasEmailIdentity;
        
        // Also check if password was explicitly set
        // Supabase stores confirmation status
        if (authUser.user.email_confirmed_at) {
          hasPassword = true;
        }
      }
    } catch (e) {
      console.error("Error checking auth user:", e);
      // Default to assuming they have a password if profile exists
      hasPassword = true;
    }

    // Mask the name for privacy
    if (userData.full_name) {
      const parts = userData.full_name.split(" ");
      if (parts.length >= 1 && parts[0]) {
        // Show first name and first letter of last name
        const firstName = parts[0];
        const lastInitial = parts.length > 1 && parts[1] ? parts[1].charAt(0) + "." : "";
        maskedName = `${firstName} ${lastInitial}`.trim();
      }
    }

    const response: CheckEmailResponse = {
      exists: true,
      hasPassword,
      maskedName,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in auth-check-email:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
