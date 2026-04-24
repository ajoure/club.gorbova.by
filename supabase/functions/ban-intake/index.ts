import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { profileId } = body;

    if (!profileId) {
      return new Response(JSON.stringify({ error: "profileId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, user_id, email, phone, telegram_user_id, telegram_username, status")
      .eq("id", profileId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already banned? Skip
    if (profile.status === "banned") {
      return new Response(JSON.stringify({ banned: true, alreadyBanned: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check ban by all identifiers
    const { data: banMatch, error: checkError } = await supabase.rpc("check_ban_by_identifiers", {
      _email: profile.email || null,
      _phone: profile.phone || null,
      _tg_user_id: profile.telegram_user_id || null,
      _tg_username: profile.telegram_username || null,
    });

    if (checkError) throw checkError;

    if (!banMatch || banMatch.length === 0) {
      return new Response(JSON.stringify({ banned: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const matchedCase = banMatch[0];

    // Set profile status to banned
    await supabase
      .from("profiles")
      .update({ status: "banned", updated_at: new Date().toISOString() })
      .eq("id", profileId);

    // Collect ALL identifiers and add to ban case
    const identifiers: { kind: string; value: string }[] = [];
    if (profile.email) identifiers.push({ kind: "email", value: profile.email });
    if (profile.phone) identifiers.push({ kind: "phone", value: profile.phone });
    if (profile.telegram_user_id) identifiers.push({ kind: "telegram_user_id", value: String(profile.telegram_user_id) });
    if (profile.telegram_username) identifiers.push({ kind: "telegram_username", value: profile.telegram_username });

    const { data: addedCount } = await supabase.rpc("ban_case_upsert_identifiers", {
      _ban_case_id: matchedCase.ban_case_id,
      _identifiers: identifiers,
    });

    // Audit log (SYSTEM ACTOR proof)
    await supabase.from("audit_logs").insert({
      actor_type: "system",
      actor_user_id: null,
      actor_label: "ban-intake",
      action: "ban_intake_enriched",
      target_user_id: profile.user_id || null,
      meta: {
        ban_case_id: matchedCase.ban_case_id,
        matched_kind: matchedCase.matched_kind,
        matched_value: matchedCase.matched_value,
        profile_id: profileId,
        identifiers_added: addedCount,
      },
    });

    return new Response(JSON.stringify({
      banned: true,
      caseId: matchedCase.ban_case_id,
      matchedBy: { kind: matchedCase.matched_kind, value: matchedCase.matched_value },
      identifiersAdded: addedCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ban-intake error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
