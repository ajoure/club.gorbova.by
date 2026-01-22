import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH 9: Legacy Cards Report & Migration
 * 
 * Modes:
 * - dry_run (default): Returns statistics without changes
 * - execute: Soft-deactivates legacy cards and notifies users
 * 
 * Legacy criteria: supports_recurring = false AND status = 'active'
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check - admin only
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: isSuperAdmin } = await userClient.rpc('is_super_admin', { _user_id: user.id });
    const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
    const isAdmin = !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'dry_run';
    const batchSize = Math.min(body.batch_size || 50, 100); // Max 100 per batch
    const sendNotifications = body.send_notifications !== false;

    console.log(`Legacy cards report: mode=${mode}, batch_size=${batchSize}, admin=${user.email}`);

    // Get legacy cards
    const { data: legacyCards, error: cardsError } = await supabase
      .from('payment_methods')
      .select(`
        id,
        user_id,
        brand,
        last4,
        exp_month,
        exp_year,
        status,
        supports_recurring,
        created_at,
        meta
      `)
      .eq('supports_recurring', false)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(200);

    if (cardsError) {
      throw cardsError;
    }

    // Get affected subscriptions
    const cardIds = legacyCards?.map(c => c.id) || [];
    const { data: affectedSubs } = await supabase
      .from('subscriptions_v2')
      .select('id, user_id, payment_method_id, status, auto_renew')
      .in('payment_method_id', cardIds)
      .in('status', ['active', 'trial', 'past_due']);

    // Get user profiles for notifications
    const userIds = [...new Set(legacyCards?.map(c => c.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, user_id, telegram_user_id, telegram_link_status, email, full_name')
      .in('user_id', userIds);

    const profilesMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

    // Build breakdown
    const byBrand: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    
    for (const card of legacyCards || []) {
      const brand = card.brand || 'unknown';
      byBrand[brand] = (byBrand[brand] || 0) + 1;

      const month = card.created_at?.substring(0, 7) || 'unknown';
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    // Build sample cards with subscription info
    const sampleCards = (legacyCards || []).slice(0, 200).map(card => {
      const userSubs = affectedSubs?.filter(s => s.payment_method_id === card.id) || [];
      const profile = profilesMap.get(card.user_id);
      
      return {
        id: card.id,
        user_id: card.user_id,
        last4: card.last4,
        brand: card.brand,
        created_at: card.created_at?.substring(0, 10),
        exp: card.exp_month && card.exp_year ? `${card.exp_month}/${card.exp_year}` : null,
        active_subscriptions: userSubs.length,
        subscription_ids: userSubs.map(s => s.id),
        has_telegram: !!profile?.telegram_user_id,
        has_email: !!profile?.email,
        reason: 'supports_recurring = false',
      };
    });

    const cardsWithSubs = sampleCards.filter(c => c.active_subscriptions > 0).length;

    // DRY-RUN response
    if (mode === 'dry_run') {
      return new Response(JSON.stringify({
        mode: 'dry_run',
        total_legacy_cards: legacyCards?.length || 0,
        unique_users: userIds.length,
        cards_with_active_subs: cardsWithSubs,
        total_affected_subscriptions: affectedSubs?.length || 0,
        breakdown: {
          by_brand: byBrand,
          by_month: byMonth,
        },
        sample_cards: sampleCards,
        execute_info: {
          will_revoke_cards: legacyCards?.length || 0,
          will_unlink_subscriptions: affectedSubs?.length || 0,
          will_notify_via_telegram: sampleCards.filter(c => c.has_telegram).length,
          will_notify_via_email: sampleCards.filter(c => c.has_email).length,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // EXECUTE mode
    if (mode !== 'execute') {
      return new Response(JSON.stringify({ error: 'Invalid mode. Use dry_run or execute' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process in batches
    const cardsToProcess = (legacyCards || []).slice(0, batchSize);
    let revokedCount = 0;
    let unlinkedSubsCount = 0;
    let notifiedCount = 0;
    const errors: string[] = [];
    const processedIds: string[] = [];

    for (const card of cardsToProcess) {
      try {
        // 1. Soft-revoke the card
        const { error: revokeError } = await supabase
          .from('payment_methods')
          .update({
            status: 'revoked',
            meta: {
              ...(card.meta || {}),
              revoked_reason: 'legacy_binding_requires_3ds',
              revoked_at: new Date().toISOString(),
              revoked_by: 'system',
              revoked_admin: user.id,
            },
          })
          .eq('id', card.id)
          .eq('status', 'active'); // Idempotency check

        if (revokeError) {
          errors.push(`Card ${card.id}: ${revokeError.message}`);
          continue;
        }

        revokedCount++;
        processedIds.push(card.id);

        // 2. Unlink from subscriptions
        const { data: unlinkedSubs, error: unlinkError } = await supabase
          .from('subscriptions_v2')
          .update({ 
            payment_method_id: null,
            meta: {
              legacy_card_unlinked_at: new Date().toISOString(),
              legacy_card_id: card.id,
            },
          })
          .eq('payment_method_id', card.id)
          .in('status', ['active', 'trial', 'past_due'])
          .select('id');

        if (unlinkError) {
          errors.push(`Unlink subs for card ${card.id}: ${unlinkError.message}`);
        } else {
          unlinkedSubsCount += unlinkedSubs?.length || 0;
        }

        // 3. Send notification (if enabled and not sent recently)
        if (sendNotifications && card.user_id) {
          const profile = profilesMap.get(card.user_id);
          
          if (profile?.telegram_user_id && profile?.telegram_link_status === 'active') {
            // Check if notification was sent in last 24h
            const { data: recentLog } = await supabase
              .from('telegram_logs')
              .select('id')
              .eq('user_id', card.user_id)
              .eq('event_type', 'legacy_card_notification')
              .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
              .limit(1);

            if (!recentLog?.length) {
              try {
                const message = `⚠️ *Обновление платёжной системы*

Ваша сохранённая карта (\\*\\*\\*\\* ${card.last4 || '????'}) удалена из личного кабинета.

*Причина:* карта была привязана в старом формате и не поддерживает автоматическое продление.

Пожалуйста, привяжите карту заново:
🔗 [Привязать карту](https://club.gorbova.by/settings/payment-methods)`;

                await supabase.functions.invoke('telegram-send-notification', {
                  body: {
                    user_id: card.user_id,
                    message,
                    parse_mode: 'Markdown',
                  },
                });

                // Log the notification
                await supabase.from('telegram_logs').insert({
                  user_id: card.user_id,
                  event_type: 'legacy_card_notification',
                  success: true,
                  meta: { card_id: card.id, last4: card.last4 },
                });

                notifiedCount++;
              } catch (notifyErr) {
                console.error('Notification error:', notifyErr);
              }
            }
          }
        }
      } catch (cardError) {
        errors.push(`Card ${card.id}: ${cardError instanceof Error ? cardError.message : 'Unknown error'}`);
      }
    }

    // Log audit
    await supabase.from('audit_logs').insert({
      action: 'payment_methods.legacy_cards_revoked',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-legacy-cards-report',
      meta: {
        mode: 'execute',
        triggered_by: user.id,
        triggered_by_email: user.email,
        total_legacy_cards: legacyCards?.length || 0,
        batch_size: batchSize,
        revoked_count: revokedCount,
        unlinked_subs_count: unlinkedSubsCount,
        notified_count: notifiedCount,
        errors_count: errors.length,
        sample_ids: processedIds.slice(0, 20),
        run_at: new Date().toISOString(),
      },
    });

    return new Response(JSON.stringify({
      mode: 'execute',
      success: true,
      total_legacy_cards: legacyCards?.length || 0,
      batch_processed: cardsToProcess.length,
      revoked_count: revokedCount,
      unlinked_subs_count: unlinkedSubsCount,
      notified_count: notifiedCount,
      errors: errors.slice(0, 10),
      remaining: Math.max(0, (legacyCards?.length || 0) - batchSize),
      sample_ids: processedIds.slice(0, 20),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Legacy cards report error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
