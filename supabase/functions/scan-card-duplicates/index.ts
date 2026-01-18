import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CardGroup {
  mask: string;
  holder: string;
  profileIds: string[];
  profileEmails: string[];
}

// Normalize card holder name for fuzzy matching
function normalizeHolderName(name: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ\s]/g, "") // Keep only letters
    .replace(/\s+/g, " ")
    .trim();
}

// Check if two names are similar (fuzzy match)
function areNamesSimilar(name1: string, name2: string): boolean {
  const n1 = normalizeHolderName(name1);
  const n2 = normalizeHolderName(name2);
  
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  
  // Check if one name contains the other (e.g., "IVAN" vs "IVAN IVANOV")
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Check if first/last names match in different order
  const parts1 = n1.split(" ").filter(Boolean);
  const parts2 = n2.split(" ").filter(Boolean);
  
  // At least one part should match
  const matchingParts = parts1.filter(p => parts2.includes(p));
  return matchingParts.length >= 1 && matchingParts.length >= Math.min(parts1.length, parts2.length) / 2;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check authorization
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Check if user is super_admin
      const { data: hasRole } = await supabase.rpc("has_role", { 
        _user_id: user.id, 
        _role: "super_admin" 
      });
      
      if (!hasRole) {
        return new Response(JSON.stringify({ error: "Forbidden: super_admin required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const { limit = 1000, dryRun = true } = body;

    console.log(`[scan-card-duplicates] Starting scan, limit=${limit}, dryRun=${dryRun}`);

    // 1. Fetch profiles with card data
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, full_name, card_masks, card_holder_names")
      .eq("is_archived", false)
      .not("card_masks", "is", null)
      .limit(limit);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      throw profilesError;
    }

    console.log(`[scan-card-duplicates] Found ${profiles?.length || 0} profiles with card data`);

    // 2. Build card groups (mask + holder -> profiles)
    const cardGroups = new Map<string, CardGroup>();

    for (const profile of profiles || []) {
      const masks = profile.card_masks as string[] || [];
      const holders = profile.card_holder_names as string[] || [];
      
      for (let i = 0; i < masks.length; i++) {
        const mask = masks[i];
        const holder = holders[i] || "";
        
        if (!mask) continue;
        
        // Try to find existing group with same mask and similar holder
        let foundGroup: CardGroup | null = null;
        for (const [key, group] of cardGroups) {
          if (group.mask === mask && areNamesSimilar(group.holder, holder)) {
            foundGroup = group;
            break;
          }
        }
        
        if (foundGroup) {
          if (!foundGroup.profileIds.includes(profile.id)) {
            foundGroup.profileIds.push(profile.id);
            foundGroup.profileEmails.push(profile.email || "");
          }
        } else {
          const key = `${mask}|${normalizeHolderName(holder)}`;
          cardGroups.set(key, {
            mask,
            holder: normalizeHolderName(holder),
            profileIds: [profile.id],
            profileEmails: [profile.email || ""],
          });
        }
      }
    }

    // 3. Filter groups with more than 1 profile (actual duplicates)
    const duplicateGroups = Array.from(cardGroups.values()).filter(g => g.profileIds.length > 1);
    
    console.log(`[scan-card-duplicates] Found ${duplicateGroups.length} duplicate groups`);

    // 4. Create duplicate cases for each group
    const results = {
      scanned: profiles?.length || 0,
      duplicateGroups: duplicateGroups.length,
      casesCreated: 0,
      casesSkipped: 0,
      errors: [] as string[],
    };

    for (const group of duplicateGroups) {
      try {
        // Check if case already exists for this card combination
        const caseIdentifier = `card:${group.mask}:${group.holder}`;
        
        const { data: existingCase } = await supabase
          .from("duplicate_cases")
          .select("id, status")
          .eq("phone", caseIdentifier)
          .eq("duplicate_type", "card")
          .maybeSingle();

        if (existingCase) {
          console.log(`[scan-card-duplicates] Case already exists for ${caseIdentifier}`);
          results.casesSkipped++;
          continue;
        }

        if (dryRun) {
          console.log(`[scan-card-duplicates] Would create case for ${caseIdentifier} with ${group.profileIds.length} profiles`);
          results.casesCreated++;
          continue;
        }

        // Create new duplicate case
        const { data: newCase, error: caseError } = await supabase
          .from("duplicate_cases")
          .insert({
            phone: caseIdentifier, // Store identifier in phone column
            duplicate_type: "card",
            status: "new",
            profile_count: group.profileIds.length,
            notes: `Card: ${group.mask}, Holder: ${group.holder}`,
          })
          .select()
          .single();

        if (caseError) {
          console.error(`[scan-card-duplicates] Error creating case:`, caseError);
          results.errors.push(`Failed to create case for ${caseIdentifier}: ${caseError.message}`);
          continue;
        }

        // Link profiles to case
        for (const profileId of group.profileIds) {
          await supabase
            .from("client_duplicates")
            .upsert({
              case_id: newCase.id,
              profile_id: profileId,
            }, { onConflict: "case_id,profile_id" });

          await supabase
            .from("profiles")
            .update({
              duplicate_flag: "duplicate_by_card",
              duplicate_group_id: newCase.id,
            })
            .eq("id", profileId);
        }

        results.casesCreated++;
        console.log(`[scan-card-duplicates] Created case ${newCase.id} for ${caseIdentifier}`);
        
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push(msg);
      }
    }

    console.log(`[scan-card-duplicates] Completed:`, results);

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      results,
      groups: duplicateGroups.map(g => ({
        mask: g.mask,
        holder: g.holder,
        profileCount: g.profileIds.length,
        emails: g.profileEmails,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("[scan-card-duplicates] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
