import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DetectDuplicatesRequest {
  phone?: string;
  email?: string;
  profileId?: string;
}

interface Profile {
  id: string;
  user_id: string | null;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  created_at: string;
}

interface DuplicateCase {
  id: string;
  status: string;
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

    if (!phone && !email) {
      return new Response(JSON.stringify({ error: "Phone or email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Detecting duplicates for phone: ${phone}, email: ${email}, profileId: ${profileId}`);

    // Detect by email
    if (email) {
      const result = await detectByEmail(supabase, email, profileId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect by phone
    if (phone) {
      const result = await detectByPhone(supabase, phone, profileId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ isDuplicate: false, duplicates: [] }), {
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

// deno-lint-ignore no-explicit-any
async function detectByEmail(supabase: SupabaseClient<any>, email: string, profileId?: string) {
  const normalizedEmail = email.toLowerCase().trim();

  // Find profiles with the same email
  const { data: matchingProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, user_id, email, phone, full_name, created_at")
    .ilike("email", normalizedEmail)
    .eq("is_archived", false);

  if (profilesError) {
    console.error("Error fetching profiles by email:", profilesError);
    throw profilesError;
  }

  const profiles = (matchingProfiles || []) as Profile[];
  console.log(`Found ${profiles.length} profiles with matching email`);

  // Filter to find actual duplicates
  const duplicates = profiles.filter(p => {
    if (profileId && p.id === profileId) return false;
    return true;
  });

  if (duplicates.length === 0) {
    console.log("No email duplicates found");
    return { isDuplicate: false, duplicates: [] };
  }

  console.log(`Found ${duplicates.length} duplicate profiles by email`);

  // Check if a case already exists for this email
  const { data: existingCaseData } = await supabase
    .from("duplicate_cases")
    .select("id, status")
    .eq("phone", normalizedEmail) // Using phone column to store email for now
    .eq("duplicate_type", "email")
    .in("status", ["new", "in_progress"])
    .maybeSingle();

  const existingCase = existingCaseData as DuplicateCase | null;

  if (existingCase) {
    // Add the new profile to existing case if not already there
    if (profileId) {
      await linkProfileToCase(supabase, existingCase.id, profileId, "email");
    }

    console.log(`Added to existing email case: ${existingCase.id}`);
    return { 
      isDuplicate: true, 
      caseId: existingCase.id,
      duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
    };
  }

  // Create new duplicate case
  const { data: newCaseData, error: caseError } = await supabase
    .from("duplicate_cases")
    .insert({
      phone: normalizedEmail, // Store email in phone column for indexing
      duplicate_type: "email",
      status: "new",
      profile_count: duplicates.length + (profileId ? 1 : 0),
    })
    .select()
    .single();

  if (caseError) {
    console.error("Error creating email case:", caseError);
    throw caseError;
  }

  const newCase = newCaseData as DuplicateCase;
  console.log(`Created new email duplicate case: ${newCase.id}`);

  // Link all duplicate profiles to the case
  const allProfileIds = [...duplicates.map(d => d.id)];
  if (profileId) allProfileIds.push(profileId);

  for (const pId of allProfileIds) {
    await linkProfileToCase(supabase, newCase.id, pId, "email");
  }

  return { 
    isDuplicate: true, 
    caseId: newCase.id,
    duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
  };
}

// deno-lint-ignore no-explicit-any
async function detectByPhone(supabase: SupabaseClient<any>, phone: string, profileId?: string) {
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

  const profiles = (matchingProfiles || []) as Profile[];
  console.log(`Found ${profiles.length} profiles with matching phone`);

  // Filter to find actual duplicates (same phone, different emails)
  const duplicates = profiles.filter(p => {
    // Exclude the current profile if provided
    if (profileId && p.id === profileId) return false;
    return true;
  });

  if (duplicates.length === 0) {
    console.log("No phone duplicates found");
    return { isDuplicate: false, duplicates: [] };
  }

  console.log(`Found ${duplicates.length} duplicate profiles by phone`);

  // Check if a case already exists for this phone
  const { data: existingCaseData } = await supabase
    .from("duplicate_cases")
    .select("id, status")
    .eq("phone", normalizedPhone)
    .eq("duplicate_type", "phone")
    .in("status", ["new", "in_progress"])
    .maybeSingle();

  const existingCase = existingCaseData as DuplicateCase | null;

  if (existingCase) {
    // Add the new profile to existing case if not already there
    if (profileId) {
      await linkProfileToCase(supabase, existingCase.id, profileId, "phone");
    }

    console.log(`Added to existing phone case: ${existingCase.id}`);
    return { 
      isDuplicate: true, 
      caseId: existingCase.id,
      duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
    };
  }

  // Create new duplicate case
  const { data: newCaseData, error: caseError } = await supabase
    .from("duplicate_cases")
    .insert({
      phone: normalizedPhone,
      duplicate_type: "phone",
      status: "new",
      profile_count: duplicates.length + (profileId ? 1 : 0),
    })
    .select()
    .single();

  if (caseError) {
    console.error("Error creating phone case:", caseError);
    throw caseError;
  }

  const newCase = newCaseData as DuplicateCase;
  console.log(`Created new phone duplicate case: ${newCase.id}`);

  // Link all duplicate profiles to the case
  const allProfileIds = [...duplicates.map(d => d.id)];
  if (profileId) allProfileIds.push(profileId);

  for (const pId of allProfileIds) {
    await linkProfileToCase(supabase, newCase.id, pId, "phone");
  }

  return { 
    isDuplicate: true, 
    caseId: newCase.id,
    duplicates: duplicates.map(d => ({ id: d.id, email: d.email, name: d.full_name })),
  };
}

// deno-lint-ignore no-explicit-any
async function linkProfileToCase(
  supabase: SupabaseClient<any>, 
  caseId: string, 
  profileId: string,
  duplicateType: string
) {
  const { error: linkError } = await supabase
    .from("client_duplicates")
    .upsert({
      case_id: caseId,
      profile_id: profileId,
    }, { onConflict: "case_id,profile_id" });

  if (linkError) {
    console.error("Error linking to case:", linkError);
  }

  // Update profile flag
  await supabase
    .from("profiles")
    .update({ 
      duplicate_flag: `duplicate_by_${duplicateType}`,
      duplicate_group_id: caseId,
    })
    .eq("id", profileId);

  // Update case profile count
  const { count } = await supabase
    .from("client_duplicates")
    .select("*", { count: "exact", head: true })
    .eq("case_id", caseId);

  await supabase
    .from("duplicate_cases")
    .update({ profile_count: count || 0 })
    .eq("id", caseId);
}
