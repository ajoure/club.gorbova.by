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

    // Auth check — super_admin only
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check super_admin role
    const { data: isSuperAdmin } = await supabase.rpc("has_role_v2", {
      _user_id: user.id,
      _role_code: "super_admin",
    });
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "add") {
      return await handleAdd(supabase, body, user.id, corsHeaders);
    } else if (action === "remove") {
      return await handleRemove(supabase, body, user.id, corsHeaders);
    } else if (action === "check") {
      return await handleCheck(supabase, body, corsHeaders);
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("ban-list-manage error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleAdd(supabase: any, body: any, actorUserId: string, cors: any) {
  const { profileId, reason } = body;
  if (!profileId) {
    return new Response(JSON.stringify({ error: "profileId required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Get profile data
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, phone, telegram_user_id, telegram_username, emails, phones")
    .eq("id", profileId)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: "Profile not found" }), {
      status: 404, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Check if active ban case already exists for this profile
  const { data: existingCase } = await supabase
    .from("ban_cases")
    .select("id")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .limit(1)
    .single();

  let banCaseId: string;

  if (existingCase) {
    banCaseId = existingCase.id;
    // Update reason if provided
    if (reason) {
      await supabase.from("ban_cases").update({ reason }).eq("id", banCaseId);
    }
  } else {
    // Create ban case
    const { data: newCase, error: caseError } = await supabase
      .from("ban_cases")
      .insert({
        profile_id: profileId,
        reason: reason || null,
        created_by: actorUserId,
        is_active: true,
      })
      .select("id")
      .single();

    if (caseError) throw caseError;
    banCaseId = newCase.id;
  }

  // Collect all identifiers
  const identifiers: { kind: string; value: string }[] = [];

  if (profile.email) identifiers.push({ kind: "email", value: profile.email });
  if (profile.phone) identifiers.push({ kind: "phone", value: profile.phone });
  if (profile.telegram_user_id) identifiers.push({ kind: "telegram_user_id", value: String(profile.telegram_user_id) });
  if (profile.telegram_username) identifiers.push({ kind: "telegram_username", value: profile.telegram_username });

  // Extra emails/phones from arrays
  if (Array.isArray(profile.emails)) {
    for (const e of profile.emails) {
      const val = typeof e === "string" ? e : e?.value;
      if (val && val !== profile.email) identifiers.push({ kind: "email", value: val });
    }
  }
  if (Array.isArray(profile.phones)) {
    for (const p of profile.phones) {
      const val = typeof p === "string" ? p : p?.value;
      if (val && val !== profile.phone) identifiers.push({ kind: "phone", value: val });
    }
  }

  // Upsert identifiers
  const { data: addedCount } = await supabase.rpc("ban_case_upsert_identifiers", {
    _ban_case_id: banCaseId,
    _identifiers: identifiers,
  });

  // Set profile status to banned
  await supabase
    .from("profiles")
    .update({ status: "banned", updated_at: new Date().toISOString() })
    .eq("id", profileId);

  // Audit log
  await supabase.from("audit_logs").insert({
    actor_type: "admin",
    actor_user_id: actorUserId,
    actor_label: "ban-list-manage",
    action: "ban_added",
    target_user_id: profile.user_id || null,
    meta: { ban_case_id: banCaseId, profile_id: profileId, identifiers_count: addedCount, reason },
  });

  return new Response(JSON.stringify({ 
    success: true, 
    banCaseId, 
    identifiersAdded: addedCount,
  }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function handleRemove(supabase: any, body: any, actorUserId: string, cors: any) {
  const { caseId, profileId } = body;
  
  if (!caseId && !profileId) {
    return new Response(JSON.stringify({ error: "caseId or profileId required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let targetCaseId = caseId;

  if (!targetCaseId && profileId) {
    const { data: caseData } = await supabase
      .from("ban_cases")
      .select("id")
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .limit(1)
      .single();
    
    if (!caseData) {
      return new Response(JSON.stringify({ error: "No active ban case found" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    targetCaseId = caseData.id;
  }

  // Deactivate identifiers
  await supabase
    .from("ban_identifiers")
    .update({ is_active: false })
    .eq("ban_case_id", targetCaseId);

  // Deactivate case
  await supabase
    .from("ban_cases")
    .update({ is_active: false })
    .eq("id", targetCaseId);

  // If profileId provided, unban the profile
  if (profileId) {
    await supabase
      .from("profiles")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", profileId)
      .eq("status", "banned");
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    actor_type: "admin",
    actor_user_id: actorUserId,
    actor_label: "ban-list-manage",
    action: "ban_removed",
    meta: { ban_case_id: targetCaseId, profile_id: profileId },
  });

  return new Response(JSON.stringify({ success: true, caseId: targetCaseId }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function handleCheck(supabase: any, body: any, cors: any) {
  const { email, phone, telegramUserId, telegramUsername } = body;

  const { data, error } = await supabase.rpc("check_ban_by_identifiers", {
    _email: email || null,
    _phone: phone || null,
    _tg_user_id: telegramUserId || null,
    _tg_username: telegramUsername || null,
  });

  if (error) throw error;

  const banned = data && data.length > 0;
  return new Response(JSON.stringify({
    banned,
    caseId: banned ? data[0].ban_case_id : null,
    matchedBy: banned ? { kind: data[0].matched_kind, value: data[0].matched_value } : null,
  }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
