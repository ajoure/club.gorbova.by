import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  from_date: string;
  to_date: string;
  dry_run?: boolean;
  selected_uids?: string[];
}

interface Difference {
  field: string;
  label: string;
  current: string | number | null;
  statement: string | number | null;
}

interface CascadeInfo {
  orders: { id: string; action: 'update' | 'cancel'; current_status: string; order_number?: string }[];
  subscriptions: { id: string; action: 'cancel' }[];
  entitlements: { id: string; action: 'revoke' }[];
  telegram_access: boolean;
}

interface SyncChange {
  uid: string;
  action: 'create' | 'update' | 'delete';
  differences?: Difference[];
  cascade?: CascadeInfo;
  statement_data: any;
  payment_data?: any;
  contact?: { id: string; name: string; email: string };
  is_dangerous: boolean;
}

interface DetailedStats {
  total: number;
  succeeded: { count: number; amount: number };
  refunded: { count: number; amount: number };
  cancelled: { count: number; amount: number };
  failed: { count: number; amount: number };
  commission_total: number;
}

interface SyncStats {
  statement_count: number;
  payments_count: number;
  matched: number;
  to_create: number;
  to_update: number;
  to_delete: number;
  applied: number;
  skipped: number;
  statement_stats?: DetailedStats;
  payments_stats?: DetailedStats;
  projected_stats?: DetailedStats;
}

interface SyncResult {
  success: boolean;
  dry_run: boolean;
  stats: SyncStats;
  changes: SyncChange[];
  audit_log_id?: string;
  error?: string;
}

// Normalize bePaid status to our canonical statuses
function normalizeStatus(rawStatus: string | null): string {
  if (!rawStatus) return 'unknown';
  const s = rawStatus.toLowerCase().trim();
  
  if (['successful', 'успешный', 'succeeded', 'success'].includes(s)) return 'succeeded';
  if (['failed', 'неуспешный', 'failure', 'error', 'declined'].includes(s)) return 'failed';
  if (['refund', 'refunded', 'возврат средств', 'возврат'].includes(s)) return 'refunded';
  if (['cancelled', 'canceled', 'отмена', 'void'].includes(s)) return 'cancelled';
  if (['pending', 'processing', 'в обработке'].includes(s)) return 'pending';
  
  return s;
}

// Normalize transaction_type to canonical English values
// CRITICAL: Prevents storing Russian values that break consistency
function normalizeTransactionType(rawType: string | null): string {
  if (!rawType) return 'payment';
  const t = rawType.toLowerCase().trim();
  
  // Refund
  if (t.includes('возврат') || t.includes('refund')) return 'refund';
  
  // Cancellation / Void
  if (t.includes('отмен') || t.includes('void') || t.includes('cancel')) return 'void';
  
  // Payment (default)
  if (t.includes('плат') || t.includes('payment')) return 'payment';
  
  return 'payment';
}

// Calculate detailed statistics for a set of rows
function calculateDetailedStats(rows: any[], isStatement: boolean): DetailedStats {
  const stats: DetailedStats = {
    total: rows.length,
    succeeded: { count: 0, amount: 0 },
    refunded: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    failed: { count: 0, amount: 0 },
    commission_total: 0,
  };
  
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    const txType = normalizeTransactionType(row.transaction_type);
    const amount = Math.abs(row.amount || 0);
    
    // Categorize by transaction_type first, then by status
    if (txType === 'refund') {
      stats.refunded.count++;
      stats.refunded.amount += amount;
    } else if (txType === 'void') {
      stats.cancelled.count++;
      stats.cancelled.amount += amount;
    } else if (status === 'failed' || status === 'error' || status === 'declined') {
      stats.failed.count++;
      stats.failed.amount += amount;
    } else if (status === 'succeeded' || status === 'successful') {
      stats.succeeded.count++;
      stats.succeeded.amount += amount;
    }
    
    // Commission only from statement
    if (isStatement) {
      stats.commission_total += row.commission_total || 0;
    }
  }
  
  return stats;
}

// Extract last 4 digits from masked card
function extractLast4(cardMasked: string | null): string | null {
  if (!cardMasked) return null;
  const match = cardMasked.match(/(\d{4})$/);
  return match ? match[1] : null;
}

// Extract card brand from masked card
function extractCardBrand(cardMasked: string | null): string | null {
  if (!cardMasked) return null;
  const upper = cardMasked.toUpperCase();
  if (upper.includes('VISA')) return 'visa';
  if (upper.includes('MASTER') || upper.includes('MC')) return 'mastercard';
  if (upper.includes('BELKART')) return 'belkart';
  if (upper.includes('MIR') || upper.includes('МИР')) return 'mir';
  return null;
}

// Compare fields between payment and statement
function compareFields(payment: any, statement: any): Difference[] {
  const diffs: Difference[] = [];
  
  // Amount
  const stmtAmount = Math.abs(statement.amount || 0);
  const pmtAmount = Math.abs(payment.amount || 0);
  if (Math.abs(stmtAmount - pmtAmount) > 0.01) {
    diffs.push({
      field: 'amount',
      label: 'Сумма',
      current: pmtAmount,
      statement: stmtAmount,
    });
  }
  
  // Status
  const stmtStatus = normalizeStatus(statement.status);
  const pmtStatus = normalizeStatus(payment.status);
  if (stmtStatus !== pmtStatus) {
    diffs.push({
      field: 'status',
      label: 'Статус',
      current: pmtStatus,
      statement: stmtStatus,
    });
  }
  
  // Transaction type
  if (statement.transaction_type && statement.transaction_type !== payment.transaction_type) {
    diffs.push({
      field: 'transaction_type',
      label: 'Тип транзакции',
      current: payment.transaction_type || '—',
      statement: statement.transaction_type,
    });
  }
  
  // Paid at
  const stmtPaidAt = statement.paid_at ? new Date(statement.paid_at).toISOString() : null;
  const pmtPaidAt = payment.paid_at ? new Date(payment.paid_at).toISOString() : null;
  if (stmtPaidAt && pmtPaidAt) {
    const timeDiff = Math.abs(new Date(stmtPaidAt).getTime() - new Date(pmtPaidAt).getTime());
    if (timeDiff > 60000) { // More than 1 minute difference
      diffs.push({
        field: 'paid_at',
        label: 'Время платежа',
        current: pmtPaidAt,
        statement: stmtPaidAt,
      });
    }
  }
  
  // Card last 4
  const stmtLast4 = extractLast4(statement.card_masked) || statement.card_last4;
  if (stmtLast4 && payment.card_last4 !== stmtLast4) {
    diffs.push({
      field: 'card_last4',
      label: 'Последние 4 цифры',
      current: payment.card_last4 || '—',
      statement: stmtLast4,
    });
  }
  
  // Card brand
  const stmtBrand = extractCardBrand(statement.card_masked) || statement.card_brand;
  if (stmtBrand && payment.card_brand !== stmtBrand) {
    diffs.push({
      field: 'card_brand',
      label: 'Бренд карты',
      current: payment.card_brand || '—',
      statement: stmtBrand,
    });
  }
  
  // Card holder
  if (statement.card_holder && payment.card_holder !== statement.card_holder) {
    diffs.push({
      field: 'card_holder',
      label: 'Владелец карты',
      current: payment.card_holder || '—',
      statement: statement.card_holder,
    });
  }
  
  // Commission
  if (statement.commission_total != null) {
    const pmtCommission = payment.meta?.commission_total;
    if (pmtCommission !== statement.commission_total) {
      diffs.push({
        field: 'commission_total',
        label: 'Комиссия',
        current: pmtCommission ?? '—',
        statement: statement.commission_total,
      });
    }
  }
  
  // Payout amount
  if (statement.payout_amount != null) {
    const pmtPayout = payment.meta?.payout_amount;
    if (pmtPayout !== statement.payout_amount) {
      diffs.push({
        field: 'payout_amount',
        label: 'К выплате',
        current: pmtPayout ?? '—',
        statement: statement.payout_amount,
      });
    }
  }
  
  return diffs;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    
    // Verify user
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check admin role
    const { data: hasRole } = await supabaseAdmin.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    
    if (!hasRole) {
      const { data: hasSuperadmin } = await supabaseAdmin.rpc('has_role', {
        _user_id: user.id,
        _role: 'superadmin',
      });
      
      if (!hasSuperadmin) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const body: SyncRequest = await req.json();
    const { from_date, to_date, dry_run = true, selected_uids } = body;

    if (!from_date || !to_date) {
      return new Response(JSON.stringify({ error: 'from_date and to_date are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[sync-statement] Starting sync: ${from_date} to ${to_date}, dry_run=${dry_run}`);

    // 1. Load statement data for period
    const { data: statementRows, error: stmtError } = await supabaseAdmin
      .from('bepaid_statement_rows')
      .select('*')
      .gte('paid_at', `${from_date}T00:00:00`)
      .lte('paid_at', `${to_date}T23:59:59`)
      .not('uid', 'is', null);

    if (stmtError) {
      console.error('[sync-statement] Statement query error:', stmtError);
      throw new Error(`Failed to load statement: ${stmtError.message}`);
    }

    // 2. Load payments_v2 for period
    const { data: payments, error: pmtError } = await supabaseAdmin
      .from('payments_v2')
      .select('*, profiles:profile_id(id, full_name, email)')
      .eq('provider', 'bepaid')
      .eq('origin', 'bepaid') // Only bePaid origin, not imports
      .gte('paid_at', `${from_date}T00:00:00`)
      .lte('paid_at', `${to_date}T23:59:59`);

    if (pmtError) {
      console.error('[sync-statement] Payments query error:', pmtError);
      throw new Error(`Failed to load payments: ${pmtError.message}`);
    }

    console.log(`[sync-statement] Loaded ${statementRows?.length || 0} statement rows, ${payments?.length || 0} payments`);

    // 3. Build indexes
    const stmtByUid = new Map((statementRows || []).map(s => [s.uid, s]));
    const pmtByUid = new Map((payments || []).map(p => [p.provider_payment_id, p]));

    const changes: SyncChange[] = [];
    let matched = 0;

    // 4. Find transactions to CREATE (in statement, not in payments)
    for (const [uid, stmt] of stmtByUid) {
      if (!pmtByUid.has(uid)) {
        changes.push({
          uid,
          action: 'create',
          statement_data: {
            amount: stmt.amount,
            status: stmt.status,
            transaction_type: stmt.transaction_type,
            paid_at: stmt.paid_at,
            card_masked: stmt.card_masked,
            card_holder: stmt.card_holder,
            commission_total: stmt.commission_total,
            payout_amount: stmt.payout_amount,
            email: stmt.email,
            phone: stmt.phone,
            currency: stmt.currency || 'BYN',
          },
          is_dangerous: false,
        });
      }
    }

    // 5. Find transactions to UPDATE (in both, but different)
    for (const [uid, pmt] of pmtByUid) {
      const stmt = stmtByUid.get(uid);
      if (stmt) {
        matched++;
        const diffs = compareFields(pmt, stmt);
        
        if (diffs.length > 0) {
          // Calculate cascade effects
          const cascade: CascadeInfo = {
            orders: [],
            subscriptions: [],
            entitlements: [],
            telegram_access: false,
          };
          
          // Check for status change to failed
          const statusDiff = diffs.find(d => d.field === 'status');
          const newStatus = statusDiff ? normalizeStatus(stmt.status) : null;
          const willRevokeAccess = statusDiff && ['failed', 'cancelled', 'refunded'].includes(newStatus!);
          
          if (willRevokeAccess && pmt.order_id) {
            // Find order
            const { data: order } = await supabaseAdmin
              .from('orders_v2')
              .select('id, order_number, status')
              .eq('id', pmt.order_id)
              .single();
            
            if (order) {
              cascade.orders.push({
                id: order.id,
                action: 'cancel',
                current_status: order.status,
                order_number: order.order_number,
              });
            }
            
            // Find subscriptions
            if (pmt.user_id) {
              const { data: subs } = await supabaseAdmin
                .from('subscriptions_v2')
                .select('id')
                .eq('user_id', pmt.user_id)
                .in('status', ['active', 'trial']);
              
              if (subs?.length) {
                cascade.subscriptions = subs.map(s => ({ id: s.id, action: 'cancel' as const }));
              }
              
              // Find entitlements
              const { data: ents } = await supabaseAdmin
                .from('entitlements')
                .select('id')
                .eq('order_id', pmt.order_id)
                .eq('status', 'active');
              
              if (ents?.length) {
                cascade.entitlements = ents.map(e => ({ id: e.id, action: 'revoke' as const }));
              }
              
              // Check for telegram access
              const { data: telegramGrants } = await supabaseAdmin
                .from('telegram_access_grants')
                .select('id')
                .eq('user_id', pmt.user_id)
                .limit(1);
              
              cascade.telegram_access = (telegramGrants?.length || 0) > 0;
            }
          }
          
          // Check for amount change
          const amountDiff = diffs.find(d => d.field === 'amount');
          if (amountDiff && pmt.order_id) {
            const { data: order } = await supabaseAdmin
              .from('orders_v2')
              .select('id, order_number, status')
              .eq('id', pmt.order_id)
              .single();
            
            if (order && !cascade.orders.find(o => o.id === order.id)) {
              cascade.orders.push({
                id: order.id,
                action: 'update',
                current_status: order.status,
                order_number: order.order_number,
              });
            }
          }
          
          const contact = pmt.profiles ? {
            id: pmt.profiles.id,
            name: pmt.profiles.full_name || '—',
            email: pmt.profiles.email || '—',
          } : undefined;
          
          changes.push({
            uid,
            action: 'update',
            differences: diffs,
            cascade: cascade.orders.length > 0 || cascade.subscriptions.length > 0 || 
                     cascade.entitlements.length > 0 || cascade.telegram_access ? cascade : undefined,
            statement_data: {
              amount: stmt.amount,
              status: stmt.status,
              transaction_type: stmt.transaction_type,
              paid_at: stmt.paid_at,
              card_masked: stmt.card_masked,
              card_holder: stmt.card_holder,
              commission_total: stmt.commission_total,
              payout_amount: stmt.payout_amount,
            },
            payment_data: {
              id: pmt.id,
              amount: pmt.amount,
              status: pmt.status,
              transaction_type: pmt.transaction_type,
              paid_at: pmt.paid_at,
              card_last4: pmt.card_last4,
              card_brand: pmt.card_brand,
              card_holder: pmt.card_holder,
              order_id: pmt.order_id,
              user_id: pmt.user_id,
            },
            contact,
            is_dangerous: willRevokeAccess || false,
          });
        }
      }
    }

    // 6. Find transactions to DELETE (in payments, not in statement)
    for (const [uid, pmt] of pmtByUid) {
      if (!stmtByUid.has(uid)) {
        // Safety: only delete if origin is 'bepaid'
        if (pmt.origin !== 'bepaid') {
          console.log(`[sync-statement] Skipping non-bepaid payment: ${uid}`);
          continue;
        }
        
        // Calculate cascade for delete
        const cascade: CascadeInfo = {
          orders: [],
          subscriptions: [],
          entitlements: [],
          telegram_access: false,
        };
        
        if (pmt.order_id) {
          const { data: order } = await supabaseAdmin
            .from('orders_v2')
            .select('id, order_number, status')
            .eq('id', pmt.order_id)
            .single();
          
          if (order) {
            cascade.orders.push({
              id: order.id,
              action: 'cancel',
              current_status: order.status,
              order_number: order.order_number,
            });
          }
        }
        
        if (pmt.user_id) {
          const { data: subs } = await supabaseAdmin
            .from('subscriptions_v2')
            .select('id')
            .eq('user_id', pmt.user_id)
            .in('status', ['active', 'trial']);
          
          if (subs?.length) {
            cascade.subscriptions = subs.map(s => ({ id: s.id, action: 'cancel' as const }));
          }
          
          if (pmt.order_id) {
            const { data: ents } = await supabaseAdmin
              .from('entitlements')
              .select('id')
              .eq('order_id', pmt.order_id)
              .eq('status', 'active');
            
            if (ents?.length) {
              cascade.entitlements = ents.map(e => ({ id: e.id, action: 'revoke' as const }));
            }
          }
          
          const { data: telegramGrants } = await supabaseAdmin
            .from('telegram_access_grants')
            .select('id')
            .eq('user_id', pmt.user_id)
            .limit(1);
          
          cascade.telegram_access = (telegramGrants?.length || 0) > 0;
        }
        
        const contact = pmt.profiles ? {
          id: pmt.profiles.id,
          name: pmt.profiles.full_name || '—',
          email: pmt.profiles.email || '—',
        } : undefined;
        
        changes.push({
          uid,
          action: 'delete',
          cascade: cascade.orders.length > 0 || cascade.subscriptions.length > 0 || 
                   cascade.entitlements.length > 0 || cascade.telegram_access ? cascade : undefined,
          statement_data: null,
          payment_data: {
            id: pmt.id,
            amount: pmt.amount,
            status: pmt.status,
            paid_at: pmt.paid_at,
            order_id: pmt.order_id,
            user_id: pmt.user_id,
          },
          contact,
          is_dangerous: true,
        });
      }
    }

    // Calculate detailed statistics
    const statementStats = calculateDetailedStats(statementRows || [], true);
    const paymentsStats = calculateDetailedStats(payments || [], false);
    
    // Calculate projected stats (what payments_v2 will look like after sync)
    // Start with current payments stats, then apply changes
    const projectedStats: DetailedStats = { ...statementStats }; // After sync, should match statement
    
    const stats: SyncStats = {
      statement_count: statementRows?.length || 0,
      payments_count: payments?.length || 0,
      matched,
      to_create: changes.filter(c => c.action === 'create').length,
      to_update: changes.filter(c => c.action === 'update').length,
      to_delete: changes.filter(c => c.action === 'delete').length,
      applied: 0,
      skipped: 0,
      statement_stats: statementStats,
      payments_stats: paymentsStats,
      projected_stats: projectedStats,
    };

    let auditLogId: string | undefined;

    // 7. Apply changes if not dry_run
    if (!dry_run) {
      const uidsToApply = selected_uids || changes.map(c => c.uid);
      
      for (const change of changes) {
        if (!uidsToApply.includes(change.uid)) {
          stats.skipped++;
          continue;
        }
        
        try {
          if (change.action === 'create') {
            const stmt = change.statement_data;
            await supabaseAdmin.from('payments_v2').insert({
              provider: 'bepaid',
              provider_payment_id: change.uid,
              origin: 'statement_sync',
              amount: Math.abs(stmt.amount),
              currency: stmt.currency || 'BYN',
              status: normalizeStatus(stmt.status),
              transaction_type: normalizeTransactionType(stmt.transaction_type),
              paid_at: stmt.paid_at,
              card_last4: extractLast4(stmt.card_masked),
              card_brand: extractCardBrand(stmt.card_masked),
              card_holder: stmt.card_holder,
              customer_email: stmt.email,
              customer_phone: stmt.phone,
              meta: {
                commission_total: stmt.commission_total,
                payout_amount: stmt.payout_amount,
                synced_from_statement: true,
                synced_at: new Date().toISOString(),
                synced_by: user.id,
              },
            });
            stats.applied++;
          }
          
          if (change.action === 'update') {
            const stmt = change.statement_data;
            const pmt = change.payment_data;
            
            // Build update object
            const updates: any = {
              amount: Math.abs(stmt.amount),
              status: normalizeStatus(stmt.status),
              transaction_type: normalizeTransactionType(stmt.transaction_type),
              paid_at: stmt.paid_at,
              card_last4: extractLast4(stmt.card_masked) || pmt.card_last4,
              card_brand: extractCardBrand(stmt.card_masked) || pmt.card_brand,
              card_holder: stmt.card_holder || pmt.card_holder,
              meta: {
                ...pmt.meta,
                commission_total: stmt.commission_total,
                payout_amount: stmt.payout_amount,
                statement_synced_at: new Date().toISOString(),
                statement_synced_by: user.id,
              },
            };
            
            await supabaseAdmin
              .from('payments_v2')
              .update(updates)
              .eq('id', pmt.id);
            
            // Apply cascade: update order amount if needed
            const amountDiff = change.differences?.find(d => d.field === 'amount');
            if (amountDiff && pmt.order_id) {
              await supabaseAdmin
                .from('orders_v2')
                .update({
                  base_price: Math.abs(stmt.amount),
                  final_price: Math.abs(stmt.amount),
                  paid_amount: Math.abs(stmt.amount),
                  meta: {
                    amount_corrected_from_statement: true,
                    previous_amount: amountDiff.current,
                    corrected_at: new Date().toISOString(),
                  },
                })
                .eq('id', pmt.order_id);
            }
            
            // Apply cascade: revoke access if status changed to failed
            const statusDiff = change.differences?.find(d => d.field === 'status');
            const newStatus = statusDiff ? normalizeStatus(stmt.status) : null;
            if (statusDiff && ['failed', 'cancelled', 'refunded'].includes(newStatus!)) {
              // Cancel order
              if (pmt.order_id) {
                await supabaseAdmin
                  .from('orders_v2')
                  .update({
                    status: 'cancelled',
                    meta: {
                      cancelled_by: 'statement_sync',
                      cancelled_at: new Date().toISOString(),
                      previous_status: change.cascade?.orders[0]?.current_status,
                    },
                  })
                  .eq('id', pmt.order_id);
              }
              
              // Cancel subscriptions
              if (pmt.user_id) {
                await supabaseAdmin
                  .from('subscriptions_v2')
                  .update({
                    status: 'cancelled',
                    auto_renew: false,
                    meta: {
                      cancelled_by: 'statement_sync',
                      cancelled_at: new Date().toISOString(),
                    },
                  })
                  .eq('user_id', pmt.user_id)
                  .in('status', ['active', 'trial']);
                
                // Revoke entitlements
                if (pmt.order_id) {
                  await supabaseAdmin
                    .from('entitlements')
                    .update({ status: 'revoked' })
                    .eq('order_id', pmt.order_id)
                    .eq('status', 'active');
                }
                
                // Revoke Telegram access
                if (change.cascade?.telegram_access) {
                  try {
                    await supabaseAdmin.functions.invoke('telegram-revoke-access', {
                      body: { user_id: pmt.user_id },
                    });
                  } catch (e) {
                    console.error('[sync-statement] Failed to revoke telegram access:', e);
                  }
                }
              }
            }
            
            stats.applied++;
          }
          
          if (change.action === 'delete') {
            const pmt = change.payment_data;
            
            // Apply cascade first
            if (pmt.order_id) {
              await supabaseAdmin
                .from('orders_v2')
                .update({
                  status: 'cancelled',
                  meta: {
                    cancelled_by: 'statement_sync_delete',
                    cancelled_at: new Date().toISOString(),
                    deleted_payment_uid: change.uid,
                  },
                })
                .eq('id', pmt.order_id);
            }
            
            if (pmt.user_id) {
              await supabaseAdmin
                .from('subscriptions_v2')
                .update({
                  status: 'cancelled',
                  auto_renew: false,
                  meta: {
                    cancelled_by: 'statement_sync_delete',
                    cancelled_at: new Date().toISOString(),
                  },
                })
                .eq('user_id', pmt.user_id)
                .in('status', ['active', 'trial']);
              
              if (pmt.order_id) {
                await supabaseAdmin
                  .from('entitlements')
                  .update({ status: 'revoked' })
                  .eq('order_id', pmt.order_id)
                  .eq('status', 'active');
              }
              
              if (change.cascade?.telegram_access) {
                try {
                  await supabaseAdmin.functions.invoke('telegram-revoke-access', {
                    body: { user_id: pmt.user_id },
                  });
                } catch (e) {
                  console.error('[sync-statement] Failed to revoke telegram access:', e);
                }
              }
            }
            
            // Delete the payment
            await supabaseAdmin
              .from('payments_v2')
              .delete()
              .eq('id', pmt.id);
            
            stats.applied++;
          }
        } catch (e: any) {
          console.error(`[sync-statement] Error applying change ${change.uid}:`, e);
        }
      }
      
      // Create audit log
      const { data: auditLog } = await supabaseAdmin
        .from('audit_logs')
        .insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'sync-payments-with-statement',
          action: 'payment.statement_sync',
          meta: {
            dry_run: false,
            from_date,
            to_date,
            stats,
            initiated_by: user.id,
            initiated_by_email: user.email,
            changes_count: changes.length,
            applied_count: stats.applied,
          },
        })
        .select('id')
        .single();
      
      auditLogId = auditLog?.id;
    }

    const result: SyncResult = {
      success: true,
      dry_run,
      stats,
      changes,
      audit_log_id: auditLogId,
    };

    console.log(`[sync-statement] Completed: ${stats.to_create} create, ${stats.to_update} update, ${stats.to_delete} delete`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[sync-statement] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      dry_run: true,
      stats: { statement_count: 0, payments_count: 0, matched: 0, to_create: 0, to_update: 0, to_delete: 0, applied: 0, skipped: 0 },
      changes: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
