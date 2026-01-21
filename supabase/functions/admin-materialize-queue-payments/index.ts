import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MaterializeRequest {
  dry_run?: boolean;
  limit?: number;
  from_date?: string;
  to_date?: string;
  only_profile_id?: string;
}

interface MaterializeResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    scanned: number;
    eligible: number;
    created: number;
    updated: number;
    skipped: number;
    duplicates: number;
    errors: number;
  };
  samples: Array<{
    queue_id: string;
    stable_uid: string;
    payment_id: string | null;
    result: 'created' | 'updated' | 'skipped' | 'duplicate' | 'error';
    error?: string;
  }>;
  warnings: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: MaterializeRequest = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true
    const limit = Math.min(body.limit || 200, 500);
    const fromDate = body.from_date;
    const toDate = body.to_date;
    const onlyProfileId = body.only_profile_id;

    const result: MaterializeResult = {
      success: true,
      dry_run: dryRun,
      stats: {
        scanned: 0,
        eligible: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicates: 0,
        errors: 0,
      },
      samples: [],
      warnings: [],
    };

    // 1. Fetch completed queue items
    let query = supabase
      .from('payment_reconcile_queue')
      .select('*')
      .eq('status', 'completed')
      .order('paid_at', { ascending: false })
      .limit(limit);

    if (fromDate) {
      query = query.gte('paid_at', fromDate);
    }
    if (toDate) {
      query = query.lte('paid_at', toDate);
    }
    if (onlyProfileId) {
      query = query.eq('matched_profile_id', onlyProfileId);
    }

    const { data: queueItems, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    }

    result.stats.scanned = queueItems?.length || 0;

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Process each queue item
    for (const queueItem of queueItems) {
      // Determine stable_uid (priority: bepaid_uid > tracking_id > id)
      const stableUid = queueItem.bepaid_uid || queueItem.tracking_id || queueItem.id;
      
      if (!stableUid) {
        result.stats.skipped++;
        continue;
      }

      result.stats.eligible++;

      // Check if payment already exists in payments_v2
      const { data: existingPayment, error: checkError } = await supabase
        .from('payments_v2')
        .select('id, provider_payment_id, profile_id, order_id')
        .eq('provider_payment_id', stableUid)
        .eq('provider', queueItem.provider || 'bepaid')
        .maybeSingle();

      if (checkError) {
        result.stats.errors++;
        if (result.samples.length < 5) {
          result.samples.push({
            queue_id: queueItem.id,
            stable_uid: stableUid,
            payment_id: null,
            result: 'error',
            error: checkError.message,
          });
        }
        continue;
      }

      // Map queue status to payments_v2 status
      const mappedStatus = queueItem.status === 'completed' ? 'succeeded' : queueItem.status;
      
      // Prepare payment data
      const paymentData = {
        provider_payment_id: stableUid,
        provider: queueItem.provider || 'bepaid',
        amount: queueItem.amount,
        currency: queueItem.currency || 'BYN',
        status: mappedStatus,
        transaction_type: queueItem.transaction_type || 'payment',
        card_last4: queueItem.card_last4,
        card_brand: queueItem.card_brand,
        paid_at: queueItem.paid_at,
        profile_id: queueItem.matched_profile_id,
        order_id: queueItem.matched_order_id || queueItem.processed_order_id,
        receipt_url: queueItem.receipt_url,
        product_name_raw: queueItem.product_name,
        meta: {
          materialized_from_queue: true,
          queue_id: queueItem.id,
          materialized_at: new Date().toISOString(),
          original_queue_status: queueItem.status,
        },
      };

      if (dryRun) {
        // In dry-run mode, just count what would happen
        if (existingPayment) {
          result.stats.duplicates++;
          if (result.samples.length < 5) {
            result.samples.push({
              queue_id: queueItem.id,
              stable_uid: stableUid,
              payment_id: existingPayment.id,
              result: 'duplicate',
            });
          }
        } else {
          result.stats.created++;
          if (result.samples.length < 5) {
            result.samples.push({
              queue_id: queueItem.id,
              stable_uid: stableUid,
              payment_id: null,
              result: 'created',
            });
          }
        }
        continue;
      }

      // Execute mode
      if (existingPayment) {
        // Update existing payment if profile_id or order_id can be improved
        const needsUpdate = 
          (!existingPayment.profile_id && paymentData.profile_id) ||
          (!existingPayment.order_id && paymentData.order_id);

        if (needsUpdate) {
          const updateFields: any = { updated_at: new Date().toISOString() };
          if (!existingPayment.profile_id && paymentData.profile_id) {
            updateFields.profile_id = paymentData.profile_id;
          }
          if (!existingPayment.order_id && paymentData.order_id) {
            updateFields.order_id = paymentData.order_id;
          }

          const { error: updateError } = await supabase
            .from('payments_v2')
            .update(updateFields)
            .eq('id', existingPayment.id);

          if (updateError) {
            result.stats.errors++;
            if (result.samples.length < 5) {
              result.samples.push({
                queue_id: queueItem.id,
                stable_uid: stableUid,
                payment_id: existingPayment.id,
                result: 'error',
                error: updateError.message,
              });
            }
          } else {
            result.stats.updated++;
            if (result.samples.length < 5) {
              result.samples.push({
                queue_id: queueItem.id,
                stable_uid: stableUid,
                payment_id: existingPayment.id,
                result: 'updated',
              });
            }

            // Audit log for update
            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'admin-materialize-queue-payments',
              action: 'queue_materialize_to_payments_v2',
              meta: {
                queue_id: queueItem.id,
                stable_uid: stableUid,
                payment_id: existingPayment.id,
                matched_profile_id: paymentData.profile_id,
                matched_order_id: paymentData.order_id,
                result: 'updated',
              },
            });
          }
        } else {
          result.stats.duplicates++;
          if (result.samples.length < 5) {
            result.samples.push({
              queue_id: queueItem.id,
              stable_uid: stableUid,
              payment_id: existingPayment.id,
              result: 'duplicate',
            });
          }
        }
      } else {
        // Insert new payment
        const { data: newPayment, error: insertError } = await supabase
          .from('payments_v2')
          .insert(paymentData)
          .select('id')
          .single();

        if (insertError) {
          // Check if it's a duplicate key error
          if (insertError.code === '23505') {
            result.stats.duplicates++;
            if (result.samples.length < 5) {
              result.samples.push({
                queue_id: queueItem.id,
                stable_uid: stableUid,
                payment_id: null,
                result: 'duplicate',
              });
            }
          } else {
            result.stats.errors++;
            if (result.samples.length < 5) {
              result.samples.push({
                queue_id: queueItem.id,
                stable_uid: stableUid,
                payment_id: null,
                result: 'error',
                error: insertError.message,
              });
            }
          }
        } else {
          result.stats.created++;
          if (result.samples.length < 5) {
            result.samples.push({
              queue_id: queueItem.id,
              stable_uid: stableUid,
              payment_id: newPayment?.id || null,
              result: 'created',
            });
          }

          // Audit log for creation
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_user_id: null,
            actor_label: 'admin-materialize-queue-payments',
            action: 'queue_materialize_to_payments_v2',
            meta: {
              queue_id: queueItem.id,
              stable_uid: stableUid,
              payment_id: newPayment?.id,
              matched_profile_id: paymentData.profile_id,
              matched_order_id: paymentData.order_id,
              result: 'created',
            },
          });
        }
      }
    }

    // Add warnings if there are issues
    if (result.stats.duplicates > result.stats.eligible * 0.5) {
      result.warnings.push(`High duplicate rate: ${result.stats.duplicates}/${result.stats.eligible} (>50%). Most queue items already exist in payments_v2.`);
    }
    if (result.stats.errors > 0) {
      result.warnings.push(`${result.stats.errors} errors occurred during processing.`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Materialize error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
