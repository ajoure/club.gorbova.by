import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * PATCH 10F: Диагностика ложных access_revoked уведомлений + компенсация
 * 
 * Режимы:
 * - dry_run (default): показывает список пострадавших пользователей
 * - execute: отправляет access_still_active_apology через gateway (идемпотентно)
 */

interface FalseNotificationIncident {
  user_id: string;
  full_name: string | null;
  email: string | null;
  telegram_user_id: number | null;
  notification_count: number;
  last_notification_at: string;
  sub_status: string | null;
  access_end_at: string | null;
}

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
    const { mode = 'dry_run', since_hours = 48, batch_size = 50 } = body;

    console.log(`[admin-false-notifications-report] mode=${mode}, since_hours=${since_hours}, batch_size=${batch_size}`);

    // =================================================================
    // Find false access_revoked notifications
    // =================================================================
    const sinceDate = new Date(Date.now() - since_hours * 60 * 60 * 1000).toISOString();
    
    // Get all access_revoked notifications in the period
    const { data: notifications, error: notifError } = await supabase
      .from('telegram_logs')
      .select('user_id, created_at, meta')
      .eq('action', 'manual_notification')
      .eq('status', 'success')
      .gte('created_at', sinceDate)
      .order('created_at', { ascending: false });

    if (notifError) {
      throw new Error(`Failed to fetch notifications: ${notifError.message}`);
    }

    // Filter to access_revoked only
    const revokedNotifications = notifications?.filter(n => 
      (n.meta as any)?.message_type === 'access_revoked'
    ) || [];

    // Group by user_id
    const userNotifications = new Map<string, { count: number; last_at: string }>();
    for (const n of revokedNotifications) {
      const userId = n.user_id;
      const existing = userNotifications.get(userId);
      if (existing) {
        existing.count++;
        if (n.created_at > existing.last_at) {
          existing.last_at = n.created_at;
        }
      } else {
        userNotifications.set(userId, { count: 1, last_at: n.created_at });
      }
    }

    // Check each user's subscription status at time of notification
    const incidents: FalseNotificationIncident[] = [];
    
    for (const [userId, info] of userNotifications) {
      // Get profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email, telegram_user_id')
        .eq('user_id', userId)
        .single();

      // Check if they had active subscription
      const { data: activeSub } = await supabase
        .from('subscriptions_v2')
        .select('id, status, access_end_at')
        .eq('user_id', userId)
        .in('status', ['active', 'trial'])
        .gt('access_end_at', new Date().toISOString())
        .order('access_end_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If they have active subscription, this was a false positive
      if (activeSub) {
        incidents.push({
          user_id: userId,
          full_name: profile?.full_name || null,
          email: profile?.email || null,
          telegram_user_id: profile?.telegram_user_id || null,
          notification_count: info.count,
          last_notification_at: info.last_at,
          sub_status: activeSub.status,
          access_end_at: activeSub.access_end_at,
        });
      }
    }

    // =================================================================
    // DRY RUN - just return the report
    // =================================================================
    if (mode === 'dry_run') {
      const withTelegram = incidents.filter(i => i.telegram_user_id);
      
      // Log the dry run
      await supabase.from('audit_logs').insert({
        action: 'notifications.false_report_dry_run',
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-false-notifications-report',
        meta: {
          since_hours,
          total_revoked_notifications: revokedNotifications.length,
          unique_users_notified: userNotifications.size,
          false_positives_found: incidents.length,
          can_send_apology_to: withTelegram.length,
        }
      });

      return new Response(JSON.stringify({
        mode: 'dry_run',
        since_hours,
        summary: {
          total_access_revoked_notifications: revokedNotifications.length,
          unique_users_notified: userNotifications.size,
          false_positives_found: incidents.length,
          duplicates: revokedNotifications.length - userNotifications.size,
          users_with_telegram: withTelegram.length,
        },
        incidents: incidents.slice(0, 100), // Limit to first 100
        execute_info: {
          will_send_apology_to: withTelegram.length,
          batch_size,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =================================================================
    // EXECUTE - send apology notifications
    // =================================================================
    if (mode === 'execute') {
      // STOP-предохранитель
      if (incidents.length > 200) {
        return new Response(JSON.stringify({
          error: 'Too many affected users. Use batch processing with smaller time windows.',
          affected_count: incidents.length,
          max_allowed: 200,
          suggestion: 'Use since_hours=12 or smaller to batch process',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const usersWithTelegram = incidents.filter(i => i.telegram_user_id);
      const toProcess = usersWithTelegram.slice(0, batch_size);
      
      let sent = 0;
      let skipped = 0;
      let failed = 0;
      const results: { user_id: string; status: string; error?: string }[] = [];

      for (const incident of toProcess) {
        try {
          // Send apology via the notification gateway (idempotent)
          const { data, error } = await supabase.functions.invoke('telegram-send-notification', {
            body: {
              user_id: incident.user_id,
              message_type: 'access_still_active_apology',
            },
          });

          if (error) {
            failed++;
            results.push({ user_id: incident.user_id, status: 'error', error: error.message });
          } else if (data?.skipped) {
            skipped++;
            results.push({ user_id: incident.user_id, status: 'skipped', error: 'Already sent recently' });
          } else if (data?.blocked) {
            skipped++;
            results.push({ user_id: incident.user_id, status: 'blocked', error: data.error });
          } else if (data?.success) {
            sent++;
            results.push({ user_id: incident.user_id, status: 'sent' });
          } else {
            failed++;
            results.push({ user_id: incident.user_id, status: 'error', error: data?.error || 'Unknown error' });
          }
        } catch (e) {
          failed++;
          results.push({ 
            user_id: incident.user_id, 
            status: 'error', 
            error: e instanceof Error ? e.message : 'Unknown error' 
          });
        }
      }

      // Log the execute action
      await supabase.from('audit_logs').insert({
        action: 'notifications.false_report_execute',
        actor_type: 'user',
        actor_user_id: user.id,
        actor_label: 'admin-false-notifications-report',
        meta: {
          since_hours,
          batch_size,
          total_incidents: incidents.length,
          processed: toProcess.length,
          sent,
          skipped,
          failed,
          remaining: usersWithTelegram.length - toProcess.length,
        }
      });

      return new Response(JSON.stringify({
        mode: 'execute',
        summary: {
          total_incidents: incidents.length,
          processed: toProcess.length,
          sent,
          skipped,
          failed,
          remaining: usersWithTelegram.length - toProcess.length,
        },
        results: results.slice(0, 50), // Limit results in response
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid mode. Use dry_run or execute' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('admin-false-notifications-report error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
