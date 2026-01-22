/**
 * merge-clients v2: Полное объединение контактов
 * 
 * ИЗМЕНЕНИЯ v2:
 * - Полный перенос Telegram данных (user_id, username, link_status)
 * - telegram_club_members.profile_id -> master (с обработкой конфликтов)
 * - audit_logs: событие CONTACT_MERGED для unmerge
 * - Очистка Telegram полей у merged профилей (вместо просто архивации)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify auth using getClaims
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for actual operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { caseId, masterId, mergedIds: rawMergedIds } = await req.json();

    if (!masterId || !rawMergedIds?.length) {
      return new Response(JSON.stringify({ error: "Missing required fields: masterId, mergedIds" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ВАЖНО: Убедиться, что masterId НЕТ в mergedIds
    const mergedIds = rawMergedIds.filter((id: string) => id !== masterId);
    if (mergedIds.length === 0) {
      return new Response(JSON.stringify({ error: "No profiles to merge after excluding master" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[merge-clients] Starting merge: master=${masterId}, merged=${mergedIds.join(",")}`);

    // ========================================
    // Расширенный SELECT profiles (с Telegram)
    // ========================================
    const { data: masterProfile, error: masterError } = await supabase
      .from("profiles")
      .select("id, user_id, telegram_user_id, telegram_username, email, full_name, phone")
      .eq("id", masterId)
      .single();

    if (masterError || !masterProfile) {
      console.error("[merge-clients] Master profile not found:", masterError);
      return new Response(JSON.stringify({ error: "Master profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mergedProfiles, error: mergedError } = await supabase
      .from("profiles")
      .select("id, user_id, telegram_user_id, telegram_username, email, full_name, phone")
      .in("id", mergedIds);

    if (mergedError || !mergedProfiles?.length) {
      console.error("[merge-clients] Merged profiles not found:", mergedError);
      return new Response(JSON.stringify({ error: "Merged profiles not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // Telegram Conflict Check (BLOCKER)
    // ========================================
    if (masterProfile.telegram_user_id) {
      const conflicting = mergedProfiles.filter(
        (p) => p.telegram_user_id && p.telegram_user_id !== masterProfile.telegram_user_id
      );
      
      if (conflicting.length > 0) {
        console.log(`[merge-clients] Telegram conflict detected: ${conflicting.length} profiles`);
        return new Response(JSON.stringify({ 
          error: "Telegram conflict",
          conflictingProfiles: conflicting.map((p) => ({ 
            id: p.id, 
            telegram_user_id: p.telegram_user_id,
            telegram_username: p.telegram_username,
          })),
          message: "Разные Telegram аккаунты. Решите конфликт вручную."
        }), { 
          status: 409, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    // Подготовка ID
    const masterProfileId = masterProfile.id;
    const masterAuthUserId = masterProfile.user_id;
    const mergedProfileIds = mergedProfiles.map((p) => p.id);
    const mergedAuthUserIds = mergedProfiles.map((p) => p.user_id).filter(Boolean) as string[];

    console.log(`[merge-clients] Master: profileId=${masterProfileId}, authUserId=${masterAuthUserId}`);
    console.log(`[merge-clients] Merged profileIds: ${mergedProfileIds.join(",")}`);
    console.log(`[merge-clients] Merged authUserIds: ${mergedAuthUserIds.join(",")}`);

    // Счётчики переносов
    let transferredOrders = 0;
    let transferredPayments = 0;
    let transferredEntitlements = 0;
    let transferredSubscriptions = 0;
    let transferredTelegramClubMembers = 0;
    let transferredTelegramAccess = 0;
    let transferredTelegramAccessGrants = 0;
    let transferredTelegramLinkTokens = 0;
    let telegramTransferred = false;
    let telegramSourceProfileId: string | null = null;

    // ========================================
    // Profile-based перенос
    // ========================================
    
    // orders_v2.profile_id
    if (mergedProfileIds.length > 0) {
      const { data: ordersData } = await supabase
        .from("orders_v2")
        .update({ profile_id: masterProfileId })
        .in("profile_id", mergedProfileIds)
        .select("id");
      transferredOrders = ordersData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredOrders} orders (profile_id)`);
    }

    // payments_v2.profile_id
    if (mergedProfileIds.length > 0) {
      const { data: paymentsData } = await supabase
        .from("payments_v2")
        .update({ profile_id: masterProfileId })
        .in("profile_id", mergedProfileIds)
        .select("id");
      transferredPayments = paymentsData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredPayments} payments (profile_id)`);
    }

    // entitlements.profile_id
    if (mergedProfileIds.length > 0) {
      const { data: entData } = await supabase
        .from("entitlements")
        .update({ profile_id: masterProfileId })
        .in("profile_id", mergedProfileIds)
        .select("id");
      transferredEntitlements = entData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredEntitlements} entitlements (profile_id)`);
    }

    // subscriptions_v2.profile_id
    if (mergedProfileIds.length > 0) {
      const { data: subsData } = await supabase
        .from("subscriptions_v2")
        .update({ profile_id: masterProfileId })
        .in("profile_id", mergedProfileIds)
        .select("id");
      transferredSubscriptions = subsData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredSubscriptions} subscriptions (profile_id)`);
    }

    // ========================================
    // telegram_club_members: перенос С обработкой конфликтов
    // ========================================
    if (mergedProfileIds.length > 0) {
      // Получить club_id где master уже есть
      const { data: masterTcm } = await supabase
        .from("telegram_club_members")
        .select("club_id")
        .eq("profile_id", masterProfileId);
      
      const masterClubIds = new Set((masterTcm || []).map(t => t.club_id));
      
      // Получить записи merged профилей
      const { data: mergedTcm } = await supabase
        .from("telegram_club_members")
        .select("id, club_id, profile_id")
        .in("profile_id", mergedProfileIds);
      
      if (mergedTcm && mergedTcm.length > 0) {
        for (const tcm of mergedTcm) {
          if (masterClubIds.has(tcm.club_id)) {
            // Конфликт: master уже есть в этом клубе - удалить дубль
            await supabase
              .from("telegram_club_members")
              .delete()
              .eq("id", tcm.id);
            console.log(`[merge-clients] Deleted duplicate tcm ${tcm.id} (club ${tcm.club_id})`);
          } else {
            // Перенести на master
            await supabase
              .from("telegram_club_members")
              .update({ profile_id: masterProfileId })
              .eq("id", tcm.id);
            masterClubIds.add(tcm.club_id);
            transferredTelegramClubMembers++;
          }
        }
      }
      console.log(`[merge-clients] Transferred ${transferredTelegramClubMembers} telegram_club_members`);
    }

    // ========================================
    // card_profile_links transfer/cleanup
    // ========================================
    let transferredCardProfileLinks = 0;
    let deletedCardProfileLinks = 0;

    if (mergedProfileIds.length > 0) {
      const { data: mergedCards } = await supabase
        .from("card_profile_links")
        .select("id, card_last4, card_brand")
        .in("profile_id", mergedProfileIds);
      
      if (mergedCards && mergedCards.length > 0) {
        const { data: masterCards } = await supabase
          .from("card_profile_links")
          .select("card_last4, card_brand")
          .eq("profile_id", masterProfileId);
        
        const normalizeCardBrand = (brand: string | null): string => {
          if (!brand) return 'unknown';
          const lower = brand.toLowerCase().trim();
          if (lower === 'master' || lower === 'mc') return 'mastercard';
          return lower;
        };
        
        const masterCardSet = new Set(
          (masterCards || []).map(c => `${c.card_last4}|${normalizeCardBrand(c.card_brand)}`)
        );
        
        for (const card of mergedCards) {
          const normalizedKey = `${card.card_last4}|${normalizeCardBrand(card.card_brand)}`;
          
          if (masterCardSet.has(normalizedKey)) {
            await supabase.from("card_profile_links").delete().eq("id", card.id);
            deletedCardProfileLinks++;
          } else {
            await supabase
              .from("card_profile_links")
              .update({ profile_id: masterProfileId })
              .eq("id", card.id);
            transferredCardProfileLinks++;
            masterCardSet.add(normalizedKey);
          }
        }
      }
      console.log(`[merge-clients] card_profile_links: transferred=${transferredCardProfileLinks}, deleted=${deletedCardProfileLinks}`);
    }

    // ========================================
    // Auth-based перенос (через profiles.user_id)
    // ========================================
    if (mergedAuthUserIds.length > 0 && masterAuthUserId) {
      // telegram_access.user_id
      const { data: taData } = await supabase
        .from("telegram_access")
        .update({ user_id: masterAuthUserId })
        .in("user_id", mergedAuthUserIds)
        .select("id");
      transferredTelegramAccess = taData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredTelegramAccess} telegram_access (user_id)`);

      // telegram_access_grants.user_id
      const { data: tagData } = await supabase
        .from("telegram_access_grants")
        .update({ user_id: masterAuthUserId })
        .in("user_id", mergedAuthUserIds)
        .select("id");
      transferredTelegramAccessGrants = tagData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredTelegramAccessGrants} telegram_access_grants (user_id)`);

      // telegram_link_tokens.user_id
      const { data: tltData } = await supabase
        .from("telegram_link_tokens")
        .update({ user_id: masterAuthUserId })
        .in("user_id", mergedAuthUserIds)
        .select("id");
      transferredTelegramLinkTokens = tltData?.length || 0;
      console.log(`[merge-clients] Transferred ${transferredTelegramLinkTokens} telegram_link_tokens (user_id)`);
    }

    // ========================================
    // Safe-update legacy orders_v2.user_id
    // ========================================
    let transferredOrdersLegacyUserId = 0;
    if (mergedAuthUserIds.length > 0 && masterAuthUserId) {
      const { data: ordersLegacyData } = await supabase
        .from("orders_v2")
        .update({ user_id: masterAuthUserId })
        .in("user_id", mergedAuthUserIds)
        .select("id");
      transferredOrdersLegacyUserId = ordersLegacyData?.length || 0;
      console.log(`[merge-clients] Safe-updated ${transferredOrdersLegacyUserId} orders (legacy user_id)`);
    }

    // ========================================
    // ПОЛНЫЙ перенос Telegram в master
    // ========================================
    if (!masterProfile.telegram_user_id) {
      const telegramSource = mergedProfiles.find((p) => p.telegram_user_id);
      if (telegramSource) {
        await supabase
          .from("profiles")
          .update({
            telegram_user_id: telegramSource.telegram_user_id,
            telegram_username: telegramSource.telegram_username,
          })
          .eq("id", masterProfileId);
        telegramTransferred = true;
        telegramSourceProfileId = telegramSource.id;
        console.log(`[merge-clients] Transferred Telegram from ${telegramSource.id} to master`);
      }
    }

    // ========================================
    // Полное "удаление" merged профилей (soft delete + очистка Telegram)
    // ========================================
    for (const profileId of mergedProfileIds) {
      await supabase
        .from("profiles")
        .update({
          is_archived: true,
          merged_to_profile_id: masterProfileId,
          duplicate_flag: "none",
          // Очистить Telegram чтобы не было конфликтов при поиске
          telegram_user_id: null,
          telegram_username: null,
        })
        .eq("id", profileId);
    }
    console.log(`[merge-clients] Archived and cleared ${mergedProfileIds.length} merged profiles`);

    // Убедиться, что master АКТИВЕН
    await supabase
      .from("profiles")
      .update({
        is_archived: false,
        merged_to_profile_id: null,
        duplicate_flag: "none",
        primary_in_group: true,
      })
      .eq("id", masterProfileId);

    // ========================================
    // Обновление duplicate_cases (если есть caseId)
    // ========================================
    if (caseId) {
      await supabase
        .from("duplicate_cases")
        .update({
          status: "merged",
          master_profile_id: masterProfileId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", caseId);

      await supabase
        .from("client_duplicates")
        .update({ is_master: true })
        .eq("case_id", caseId)
        .eq("profile_id", masterProfileId);

      await supabase
        .from("client_duplicates")
        .update({ is_master: false })
        .eq("case_id", caseId)
        .in("profile_id", mergedProfileIds);
    }

    // ========================================
    // merge_history (для возможности unmerge)
    // ========================================
    const mergeHistoryData = {
      merged_profile_ids: mergedProfileIds,
      merged_auth_user_ids: mergedAuthUserIds,
      merged_profiles_snapshot: mergedProfiles.map(p => ({
        id: p.id,
        user_id: p.user_id,
        email: p.email,
        full_name: p.full_name,
        phone: p.phone,
        telegram_user_id: p.telegram_user_id,
        telegram_username: p.telegram_username,
      })),
      transferred: {
        orders: transferredOrders,
        orders_legacy_user_id: transferredOrdersLegacyUserId,
        payments: transferredPayments,
        entitlements: transferredEntitlements,
        subscriptions: transferredSubscriptions,
        telegram_club_members: transferredTelegramClubMembers,
        telegram_access: transferredTelegramAccess,
        telegram_access_grants: transferredTelegramAccessGrants,
        telegram_link_tokens: transferredTelegramLinkTokens,
        card_profile_links_transferred: transferredCardProfileLinks,
        card_profile_links_deleted: deletedCardProfileLinks,
      },
      telegram_transferred: telegramTransferred,
      telegram_source_profile_id: telegramSourceProfileId,
      merged_by: claimsData.claims.sub,
      merged_at: new Date().toISOString(),
    };

    const { data: mergeHistoryRecord } = await supabase
      .from("merge_history")
      .insert({
        case_id: caseId || null,
        master_profile_id: masterProfileId,
        merged_data: mergeHistoryData,
      })
      .select("id")
      .single();

    // ========================================
    // audit_logs: событие CONTACT_MERGED (для timeline + unmerge)
    // ========================================
    await supabase.from("audit_logs").insert({
      action: "CONTACT_MERGED",
      actor_user_id: claimsData.claims.sub,
      actor_type: "admin",
      target_user_id: masterAuthUserId,
      meta: {
        master_profile_id: masterProfileId,
        merged_profile_ids: mergedProfileIds,
        merged_profiles: mergedProfiles.map(p => ({
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          telegram_user_id: p.telegram_user_id,
        })),
        merge_history_id: mergeHistoryRecord?.id,
        can_unmerge: true,
        transferred: mergeHistoryData.transferred,
      },
    });

    console.log("[merge-clients] Merge completed successfully with audit log");

    return new Response(JSON.stringify({
      success: true,
      transferred: {
        orders: transferredOrders,
        orders_legacy_user_id: transferredOrdersLegacyUserId,
        payments: transferredPayments,
        entitlements: transferredEntitlements,
        subscriptions: transferredSubscriptions,
        telegram_club_members: transferredTelegramClubMembers,
        telegram_access: transferredTelegramAccess,
        telegram_access_grants: transferredTelegramAccessGrants,
        telegram_link_tokens: transferredTelegramLinkTokens,
      },
      telegram_transferred: telegramTransferred,
      merge_history_id: mergeHistoryRecord?.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("[merge-clients] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});