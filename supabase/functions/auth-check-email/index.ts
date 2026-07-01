import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CheckEmailRequest {
  email: string;
}

interface CheckEmailResponse {
  exists: boolean;
  hasPassword: boolean;
  has_password?: boolean;
  maskedName?: string;
  profile_name?: string;
}

async function findAuthUserByEmail(supabaseAdmin: any, email: string): Promise<any | null> {
  const normalized = email.toLowerCase().trim();
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      console.error(`[auth-check-email] listUsers page=${page} error:`, error);
      return null;
    }

    const users = data?.users ?? [];
    const found = users.find((user: any) => String(user?.email || "").toLowerCase().trim() === normalized);
    if (found) return found;
    if (users.length < PAGE_SIZE) break;
  }

  return null;
}

Deno.serve(async (req) => {
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

    // Find the best profile row by normalized email. Do not use maybeSingle():
    // legacy imports contain duplicate email groups and maybeSingle() turns that
    // into an error, breaking registration/password-reset discovery.
    const { data: profileRows, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, email")
      .ilike("email", email)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (profileError) {
      console.error("[auth-check-email] profile lookup failed:", profileError);
    }

    const rows = Array.isArray(profileRows) ? profileRows : [];
    const userData = rows.find((row: any) => String(row?.email || "").toLowerCase().trim() === email) ?? rows[0] ?? null;
    const authUserByEmail = await findAuthUserByEmail(supabaseAdmin, email);

    if (!userData && !authUserByEmail) {
      // User doesn't exist
      const response: CheckEmailResponse = {
        exists: false,
        hasPassword: false,
        has_password: false,
      };
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User exists. Legacy/imported/archived profiles can have user_id IS NULL:
    // they are claimable accounts, but do not have a password yet. Returning
    // hasPassword=true here sends people to the login form where they can never
    // sign in, which was the registration regression.
    let hasPassword = Boolean(authUserByEmail);
    let maskedName: string | undefined;

    if (!authUserByEmail && userData?.user_id) {
      try {
        const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(
          userData.user_id
        );

        if (getUserError) {
          console.warn("[auth-check-email] getUserById failed:", getUserError.message || getUserError);
        }

        if (authUser?.user) {
          hasPassword = true;
        }
      } catch (e) {
        console.error("[auth-check-email] error checking auth user:", e);
        hasPassword = false;
      }
    }

    // Mask the name for privacy
    if (userData?.full_name) {
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
      has_password: hasPassword,
      maskedName,
      profile_name: maskedName,
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
