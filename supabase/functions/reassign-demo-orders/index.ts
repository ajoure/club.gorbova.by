import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mapping: customer_email -> archived profile ID
const EMAIL_TO_PROFILE_MAP: Record<string, { profileId: string; name: string }> = {
  "volhapp@gmail.com": { profileId: "c0177897-3ad4-472e-8c1f-7028427a7f72", name: "Корзун Ольга" },
  "mila-milanka@mail.ru": { profileId: "2ab73923-5923-4e6a-8077-d699fc0381f4", name: "Демко Людмила" },
  "a5153253@yandex.by": { profileId: "fce4ac35-ba11-4974-ae9f-28cf8c47d4d4", name: "Чаплыгина Татьяна" },
  "marinastaravoitova@mail.ru": { profileId: "532e7039-7ffb-4ffc-a9f8-96a8951e9be2", name: "Ворфоломеева Марина" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dryRun = false } = await req.json().catch(() => ({}));

    console.log(`Reassigning demo orders. Dry run: ${dryRun}`);

    const results: {
      ordersReassigned: { orderNumber: string; from: string; to: string; email: string }[];
      paymentsReassigned: number;
      subscriptionsReassigned: number;
      entitlementsReassigned: number;
      profilesUpdated: string[];
      demoProfilesArchived: string[];
    } = {
      ordersReassigned: [],
      paymentsReassigned: 0,
      subscriptionsReassigned: 0,
      entitlementsReassigned: 0,
      profilesUpdated: [],
      demoProfilesArchived: [],
    };

    // Get orders that have customer_email matching our mapping
    const emailsToMatch = Object.keys(EMAIL_TO_PROFILE_MAP);
    
    const { data: demoOrders, error: ordersError } = await supabase
      .from("orders_v2")
      .select(`id, order_number, customer_email, customer_phone, user_id, status,
        final_price, base_price, product_id, tariff_id, created_at`)
      .in("customer_email", emailsToMatch);

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    console.log(`Found ${demoOrders?.length || 0} orders with matching emails`);

    for (const order of demoOrders || []) {
      const email = order.customer_email?.toLowerCase();
      if (!email) continue;

      const mapping = EMAIL_TO_PROFILE_MAP[email];
      if (!mapping) {
        console.log(`No mapping for email: ${email}`);
        continue;
      }

      console.log(`Processing order ${order.order_number}: ${email} -> ${mapping.name}`);

      // Get target archived profile
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name")
        .eq("id", mapping.profileId)
        .single();

      if (!targetProfile) {
        console.log(`Target profile not found: ${mapping.profileId}`);
        continue;
      }

      let targetUserId = targetProfile.user_id;

      const demoUserId = order.user_id;

      // Fetch demo profile ONCE (do not lookup by user_id after updates, it may be transferred)
      let demoProfile: { id: string; email: string | null; user_id: string | null } | null = null;
      if (demoUserId) {
        const { data: dp } = await supabase
          .from("profiles")
          .select("id, email, user_id")
          .eq("user_id", demoUserId)
          .single();
        if (dp) demoProfile = dp;
      }

      // Prefer transferring the existing demo auth user to the real profile.
      // This keeps all existing orders/payments linked, and fixes the UI contact immediately.
      if (!targetUserId && demoUserId && demoProfile) {
        targetUserId = demoUserId;

        if (!dryRun) {
          await supabase
            .from("profiles")
            .update({
              user_id: targetUserId,
              status: "active",
              is_archived: false,
              was_club_member: true,
            })
            .eq("id", mapping.profileId);

          await supabase
            .from("profiles")
            .update({
              user_id: null,
              status: "archived",
              is_archived: true,
              merged_to_profile_id: mapping.profileId,
            })
            .eq("id", demoProfile.id);

          results.profilesUpdated.push(targetProfile.full_name);
          results.demoProfilesArchived.push(demoProfile.email ?? demoProfile.id);
        }
      }

      // If still no user_id, create a new auth user
      if (!targetUserId) {
        console.log(`Creating auth user for ${targetProfile.email}`);

        if (!dryRun) {
          const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: targetProfile.email,
            email_confirm: true,
            user_metadata: { full_name: targetProfile.full_name },
          });

          if (authError) {
            console.log(
              `Auth user creation failed: ${authError.message}, trying to find existing user`,
            );
            const { data: existingUser } = await supabase.auth.admin.listUsers();
            const found = existingUser?.users?.find((u) => u.email === targetProfile.email);
            if (found) {
              targetUserId = found.id;
            } else {
              console.log(`Could not create or find auth user for ${targetProfile.email}`);
              continue;
            }
          } else {
            targetUserId = authUser.user.id;
          }

          await supabase
            .from("profiles")
            .update({
              user_id: targetUserId,
              status: "active",
              is_archived: false,
              was_club_member: true,
            })
            .eq("id", mapping.profileId);

          results.profilesUpdated.push(targetProfile.full_name);
        }
      }

      if (!targetUserId && !dryRun) {
        console.log(`No user_id for profile ${mapping.profileId}`);
        continue;
      }

      if (!dryRun && targetUserId) {
        // Reassign order
        const { error: updateError } = await supabase
          .from("orders_v2")
          .update({ user_id: targetUserId })
          .eq("id", order.id);

        if (updateError) {
          console.log(`Failed to update order: ${updateError.message}`);
          continue;
        }

        // Reassign related payments
        await supabase
          .from("payments_v2")
          .update({ user_id: targetUserId })
          .eq("order_id", order.id);

        // Reassign subscriptions
        const { data: subs } = await supabase
          .from("subscriptions_v2")
          .update({ user_id: targetUserId })
          .eq("order_id", order.id);

        if (subs) results.subscriptionsReassigned++;

        // Reassign installment payments
        await supabase
          .from("installment_payments")
          .update({ user_id: targetUserId })
          .eq("order_id", order.id);

        // Archive demo profile by ID captured before any updates
        if (demoProfile) {
          await supabase
            .from("profiles")
            .update({
              status: "archived",
              is_archived: true,
              merged_to_profile_id: mapping.profileId,
            })
            .eq("id", demoProfile.id);

          results.demoProfilesArchived.push(demoProfile.email ?? demoProfile.id);
        }

        results.paymentsReassigned++;
      }

      results.ordersReassigned.push({
        orderNumber: order.order_number,
        from: "Demo",
        to: mapping.name,
        email: email,
      });
    }

    console.log(`Reassignment complete:`, results);

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Reassign error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
