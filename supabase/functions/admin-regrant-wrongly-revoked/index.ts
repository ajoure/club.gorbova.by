import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH 11C: Admin repair job to re-grant Telegram access to wrongly revoked users
 * 
 * Finds users who have active subscription (access_end_at > now()) but are not in Telegram,
 * and re-grants their access.
 * 
 * Режимы:
 * - dry_run (default): показывает список пострадавших пользователей
 * - execute: вызывает telegram-grant-access для каждого (батч)
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    
    // Admin check
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userRole } = await userClient.rpc('get_user_role', { _user_id: user.id });
    const { data: isSuperAdmin } = await userClient.rpc('is_super_admin', { _user_id: user.id });
    
    const isAdmin = !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { mode = 'dry_run', batch_size = 50 } = body;

    console.log(`[admin-regrant-wrongly-revoked] mode=${mode}, batch_size=${batch_size}`);

    // =================================================================
    // Find wrongly revoked users via RPC
    // =================================================================
    interface WronglyRevokedUser {
      user_id: string;
      profile_id: string;
      full_name: string | null;
      email: string | null;
      telegram_user_id: number | null;
      status: string;
      access_end_at: string;
      in_chat: boolean | null;
      access_status: string | null;
      club_id: string | null;
      access_source: string | null; // NEW: subscription, entitlement, or manual_access
    }

    const { data: wronglyRevoked, error: rpcError } = await supabase.rpc('find_wrongly_revoked_users');

    if (rpcError) {
      throw new Error(`RPC error: ${rpcError.message}`);
    }

    const users = (wronglyRevoked || []) as WronglyRevokedUser[];
    console.log(`[admin-regrant-wrongly-revoked] Found ${users.length} wrongly revoked users`);

    // =================================================================
    // DRY RUN - just return the report
    // =================================================================
    if (mode === 'dry_run') {
      // Group by status for summary
      const byStatus: Record<string, number> = {};
      for (const u of users) {
        byStatus[u.status] = (byStatus[u.status] || 0) + 1;
      }

      // Log the dry run
      await supabase.from('audit_logs').insert({
        action: 'telegram.regrant_dry_run',
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-regrant-wrongly-revoked',
        meta: {
          found_count: users.length,
          by_status: byStatus,
          sample_ids: users.slice(0, 10).map(u => u.user_id),
        }
      });

      return new Response(JSON.stringify({
        mode: 'dry_run',
        summary: {
          total_wrongly_revoked: users.length,
          by_status: byStatus,
          batch_size,
        },
        users: users.slice(0, 100).map(u => ({
          user_id: u.user_id,
          full_name: u.full_name,
          email: u.email,
          status: u.status,
          access_end_at: u.access_end_at,
          in_chat: u.in_chat,
          access_status: u.access_status,
        })),
        execute_info: {
          will_regrant: Math.min(users.length, batch_size),
          remaining: Math.max(0, users.length - batch_size),
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // EXECUTE - re-grant access
    // =================================================================
    if (mode === 'execute') {
      // STOP-предохранитель
      if (users.length > 200) {
        return new Response(JSON.stringify({
          error: 'Too many affected users. Process in batches.',
          affected_count: users.length,
          max_allowed: 200,
          suggestion: 'Use batch_size=50 and run multiple times',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const toProcess = users.slice(0, batch_size);
      
      let regranted = 0;
      let skipped = 0;
      let failed = 0;
      const results: { user_id: string; status: string; error?: string }[] = [];

      for (const u of toProcess) {
        try {
          // PATCH 13+: Throttle between users to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
          
          // PATCH 13C: Skip if already in_chat (idempotency)
          if (u.in_chat === true) {
            skipped++;
            results.push({ user_id: u.user_id, status: 'skipped', error: 'already_in_chat' });
            
            // Update invite tracking
            await supabase.from('telegram_club_members').update({
              invite_status: 'skipped',
              invite_sent_at: new Date().toISOString(),
            }).eq('telegram_user_id', u.telegram_user_id).eq('club_id', u.club_id);
            
            continue;
          }

          // Re-grant via telegram-grant-access
          const { data, error } = await supabase.functions.invoke('telegram-grant-access', {
            body: {
              user_id: u.user_id,
              club_id: u.club_id,
              reason: 'regrant_wrongly_revoked',
              is_regrant: true,
            },
          });

          // PATCH 13+: Check for rate limit and STOP batch
          if (data?.blocked_by_rate_limit || data?.rate_limited) {
            const retryAfter = data.retry_after || 60;
            const retryAt = new Date(Date.now() + retryAfter * 1000);
            
            // Update invite tracking for this user
            await supabase.from('telegram_club_members').update({
              invite_status: 'rate_limited',
              invite_retry_after: retryAt.toISOString(),
              invite_error: `Rate limited for ${retryAfter}s`,
            }).eq('telegram_user_id', u.telegram_user_id).eq('club_id', u.club_id);
            
            // Log the rate limit event
            await supabase.from('audit_logs').insert({
              action: 'telegram.regrant_rate_limited',
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'admin-regrant-wrongly-revoked',
              meta: {
                initiated_by: user.id,
                stopped_at_user: u.user_id,
                retry_after: retryAfter,
                processed_before_stop: regranted + skipped + failed,
                remaining: toProcess.length - (regranted + skipped + failed),
              }
            });
            
            // STOP batch and return
            return new Response(JSON.stringify({
              mode: 'execute',
              blocked_by_rate_limit: true,
              retry_after: retryAfter,
              processed: regranted + skipped + failed,
              regranted,
              skipped,
              failed,
              remaining: users.length - (regranted + skipped + failed),
              message: `Rate limited by Telegram. Retry after ${retryAfter} seconds.`,
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          if (error) {
            failed++;
            results.push({ user_id: u.user_id, status: 'error', error: error.message });
            
            // Update invite tracking
            await supabase.from('telegram_club_members').update({
              invite_status: 'error',
              invite_error: error.message,
              invite_sent_at: new Date().toISOString(),
            }).eq('telegram_user_id', u.telegram_user_id).eq('club_id', u.club_id);
            
          } else if (data?.success) {
            regranted++;
            results.push({ user_id: u.user_id, status: 'regranted' });

            // PATCH 13C: Send access_granted notification after successful regrant
            try {
              await supabase.functions.invoke('telegram-send-notification', {
                body: {
                  user_id: u.user_id,
                  message_type: 'access_granted',
                },
                headers: {
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
              });
            } catch (notifyErr) {
              console.log(`[regrant] Failed to send notification to ${u.user_id}:`, notifyErr);
              // Don't fail the regrant if notification fails
            }
          } else {
            failed++;
            results.push({ user_id: u.user_id, status: 'error', error: data?.error || 'Unknown' });
            
            // Update invite tracking
            await supabase.from('telegram_club_members').update({
              invite_status: 'error',
              invite_error: data?.error || 'Unknown error',
              invite_sent_at: new Date().toISOString(),
            }).eq('telegram_user_id', u.telegram_user_id).eq('club_id', u.club_id);
          }
        } catch (e) {
          failed++;
          results.push({ 
            user_id: u.user_id, 
            status: 'error', 
            error: e instanceof Error ? e.message : 'Unknown error' 
          });
          
          // Update invite tracking
          await supabase.from('telegram_club_members').update({
            invite_status: 'error',
            invite_error: e instanceof Error ? e.message : 'Unknown error',
            invite_sent_at: new Date().toISOString(),
          }).eq('telegram_user_id', u.telegram_user_id).eq('club_id', u.club_id);
        }
      }

      // Log with SYSTEM ACTOR proof
      await supabase.from('audit_logs').insert({
        action: 'telegram.regrant_wrongly_revoked_completed',
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'admin-regrant-wrongly-revoked',
        meta: {
          initiated_by: user.id,
          batch_size,
          total_found: users.length,
          processed: toProcess.length,
          regranted,
          skipped,
          failed,
          remaining: users.length - toProcess.length,
          sample_regranted: results.filter(r => r.status === 'regranted').slice(0, 10).map(r => r.user_id),
        }
      });

      return new Response(JSON.stringify({
        mode: 'execute',
        summary: {
          total_found: users.length,
          processed: toProcess.length,
          regranted,
          skipped,
          failed,
          remaining: users.length - toProcess.length,
        },
        results: results.slice(0, 50),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid mode. Use dry_run or execute' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('admin-regrant-wrongly-revoked error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
