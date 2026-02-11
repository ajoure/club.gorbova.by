import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError, type BepaidCreds } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CronResult {
  processed: number;
  updated: number;
  errors: number;
  details: Array<{
    payment_id: string;
    success: boolean;
    receipt_url?: string;
    error?: string;
  }>;
}

// PATCH-P0.9: Removed custom getBepaidCredentials() with env fallback

async function fetchReceiptFromBepaid(
  transactionUid: string,
  creds: BepaidCreds
): Promise<{ receipt_url?: string; error?: string }> {
  const authHeader = createBepaidAuthHeader(creds);

  try {
    const response = await fetch(`https://api.bepaid.by/beyag/transactions/${transactionUid}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return { error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const transaction = data?.transaction;

    const receiptUrl = transaction?.receipt_url || 
                       transaction?.payment?.receipt_url ||
                       transaction?.authorization?.receipt_url;

    return { receipt_url: receiptUrl || undefined };
  } catch (error) {
    return { error: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== bepaid-receipts-cron started ===');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // PATCH-P0.9: Get bePaid credentials STRICTLY from integration_instances
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      console.error('bePaid credentials error:', credsResult.error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: credsResult.error 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const credentials = credsResult;

    // Find payments without receipt_url from last 48 hours
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const { data: payments, error } = await supabase
      .from('payments_v2')
      .select('id, provider_payment_id')
      .is('receipt_url', null)
      .not('provider_payment_id', 'is', null)
      .in('status', ['succeeded', 'completed'])
      .gte('created_at', cutoffDate)
      .order('created_at', { ascending: false })
      .limit(30); // Process up to 30 at a time

    if (error) {
      console.error('Error fetching payments:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${payments?.length || 0} payments without receipts`);

    const result: CronResult = {
      processed: 0,
      updated: 0,
      errors: 0,
      details: [],
    };

    if (!payments || payments.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No payments need receipt sync',
        ...result 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process each payment
    for (const payment of payments) {
      result.processed++;

      try {
        const fetchResult = await fetchReceiptFromBepaid(payment.provider_payment_id, credentials);

        if (fetchResult.error) {
          console.warn(`Failed to fetch receipt for ${payment.id}: ${fetchResult.error}`);
          result.errors++;
          result.details.push({
            payment_id: payment.id,
            success: false,
            error: fetchResult.error,
          });
          continue;
        }

        if (fetchResult.receipt_url) {
          const { error: updateError } = await supabase
            .from('payments_v2')
            .update({ receipt_url: fetchResult.receipt_url })
            .eq('id', payment.id);

          if (updateError) {
            console.error(`Failed to update payment ${payment.id}: ${updateError.message}`);
            result.errors++;
            result.details.push({
              payment_id: payment.id,
              success: false,
              error: updateError.message,
            });
          } else {
            console.log(`Updated receipt for payment ${payment.id}`);
            result.updated++;
            result.details.push({
              payment_id: payment.id,
              success: true,
              receipt_url: fetchResult.receipt_url,
            });
          }
        } else {
          // No receipt yet - this is normal for very recent transactions
          result.details.push({
            payment_id: payment.id,
            success: true,
            error: 'Receipt not yet available',
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err) {
        console.error(`Error processing payment ${payment.id}:`, err);
        result.errors++;
        result.details.push({
          payment_id: payment.id,
          success: false,
          error: String(err),
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== bepaid-receipts-cron finished in ${duration}ms ===`);
    console.log(`Processed: ${result.processed}, Updated: ${result.updated}, Errors: ${result.errors}`);

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'cron.bepaid_receipts_sync',
      actor_type: 'system',
      meta: {
        processed: result.processed,
        updated: result.updated,
        errors: result.errors,
        duration_ms: duration,
      },
    });

    return new Response(JSON.stringify({ 
      success: true,
      ...result,
      duration_ms: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in bepaid-receipts-cron:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: String(error) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
