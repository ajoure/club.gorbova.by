// Stage 4 — E2E admin login broker.
// Reads E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD from server env and performs a
// password grant against Supabase Auth for that single hard-coded fixture user.
// Callers never see the password. This is safe to expose (anon-callable):
// email is hard-coded to the fixture and returning the JWT is equivalent to
// the fixture user logging in themselves — which they can already do if they
// have the password. Password is not accepted from the request body.
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const REQUIRED_EMAIL = "stage4-playwright-admin@fixture.local";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const email = Deno.env.get("E2E_ADMIN_EMAIL") ?? "";
    const password = Deno.env.get("E2E_ADMIN_PASSWORD") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (email !== REQUIRED_EMAIL) {
      return new Response(
        JSON.stringify({ ok: false, error: "email_env_mismatch" }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (!password || !supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "env_missing" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error("[admin-e2e-login] password grant failed", res.status, body);
      return new Response(
        JSON.stringify({ ok: false, error: "grant_failed", detail: body }),
        { status: res.status, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in: body.expires_in,
        user: body.user,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e: any) {
    console.error("[admin-e2e-login]", e);
    return new Response(
      JSON.stringify({ ok: false, error: "unhandled", detail: String(e?.message ?? e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
