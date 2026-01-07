import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DetectDuplicatesRequest {
  phone: string;
  email?: string;
  profileId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { phone, email, profileId } = await req.json() as DetectDuplicatesRequest;

    if (!phone) {
      return new Response(JSON.stringify({ error: "Phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Detecting duplicates for phone: ${phone}, email: ${email}, profileId: ${profileId}`);

    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");

    // Find profiles with the same phone but different emails
    const { data: matchingProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, user_id, email, phone, full_name, created_at")
      .ilike("phone", `%${normalizedPhone.slice(-9)}%`) // Match last 9 digits
      .eq("is_archived", false);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      throw profilesError;
    }

    console.log(`Found ${matchingProfiles?.length || 0} profiles with matching phone`);

    // Filter to find actual duplicates (same phone, different emails)
    const duplicates = matchingProfiles?.filter(p => {
      // Exclude the current profile if provided
      if (profileId && p.id === profileId) return false;
      // Only include if email is different (duplicate by phone)
      if (email && p.email?.toLowerCase() === email.toLowerCase()) return false;
      return true;
    }) || [];

    if (duplicates.length === 0) {
      console.log("No duplicates found");
      return new Response(JSON.stringify({ isDuplicate: false, duplicates: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${duplicates.length} duplicate profiles`);

    // Check if a case already exists for this phone
    const { data: existingCase } = await supabase
      .from("duplicate_cases")
      .select("id, status")
      .eq("phone", normalizedPhone)
      .in("status", ["new", "in_progress"])
      .maybeSingle();

    if (existingCase) {
      // Add the new profile to existing case if not already there
      if (profileId) {
        const { error: linkError } = await supabase
          .from("client_duplicates")
          .upsert({
            case_id: existingCase.id,
            profile_id: profileId,
          }, { onConflict: "case_id,profile_id" });

        if (linkError) {
          console.error("Error linking to existing case:", linkError);
        }

        // Update profile flag
        await supabase
          .from("profiles")
          .update({ 
            duplicate_flag: "duplicate_by_phone",
            duplicate_group_id: existingCase.id,
          })
          .eq("id", profileId);

        // Update case profile count
        const { count } = await supabase
          .from("client_duplicates")
          .select("*", { count: "exact", head: true })
          .eq("case_id", existingCase.id);

        await supabase
          .from("duplicate_cases")
          .update({ profile_count: count || 0 })
          .eq("id", existingCase.id);
      }

      console.log(`Added to existing case: ${existingCase.id}`);
      return new Response(JSON.stringify({ 
        isDuplicate: true, 
        caseId: existingCase.id,
        duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create new duplicate case
    const { data: newCase, error: caseError } = await supabase
      .from("duplicate_cases")
      .insert({
        phone: normalizedPhone,
        status: "new",
        profile_count: duplicates.length + (profileId ? 1 : 0),
      })
      .select()
      .single();

    if (caseError) {
      console.error("Error creating case:", caseError);
      throw caseError;
    }

    console.log(`Created new duplicate case: ${newCase.id}`);

    // Link all duplicate profiles to the case
    const allProfileIds = [...duplicates.map(d => d.id)];
    if (profileId) allProfileIds.push(profileId);

    for (const pId of allProfileIds) {
      await supabase
        .from("client_duplicates")
        .insert({ case_id: newCase.id, profile_id: pId });

      await supabase
        .from("profiles")
        .update({ 
          duplicate_flag: "duplicate_by_phone",
          duplicate_group_id: newCase.id,
        })
        .eq("id", pId);
    }

    return new Response(JSON.stringify({ 
      isDuplicate: true, 
      caseId: newCase.id,
      duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Detect duplicates error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
