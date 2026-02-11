import { createClient } from 'npm:@supabase/supabase-js@2';
// PATCH-P0.9.1: Strict isolation
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillResult {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ order_id: string; error: string }>;
  candidates?: Array<{ order_id: string; order_number: string; customer_email: string | null; created_at: string }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check superadmin role only
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const userRoles = roles?.map(r => r.role) || [];
    const isSuperAdmin = userRoles.includes('super_admin');

    if (!isSuperAdmin) {
      return new Response(
        JSON.stringify({ error: 'Super admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { 
      since_days = 90, 
      limit = 50, 
      dry_run = true, 
      only_missing_receipt = true 
    } = body;

    console.log(`bepaid-docs-backfill: since_days=${since_days}, limit=${limit}, dry_run=${dry_run}, only_missing_receipt=${only_missing_receipt}`);

    // Log attempt
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_docs_backfill_started',
      meta: { since_days, limit, dry_run, only_missing_receipt },
    });

    // Build query for candidates
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - since_days);

    // Get paid orders with bePaid payments
    let query = supabase
      .from('orders_v2')
      .select(`
        id,
        order_number,
        customer_email,
        created_at,
        payments_v2!inner(
          id,
          provider,
          provider_payment_id,
          receipt_url,
          status
        )
      `)
      .eq('status', 'paid')
      .gte('created_at', sinceDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data: orders, error: queryError } = await query;

    if (queryError) {
      console.error('Query error:', queryError);
      return new Response(
        JSON.stringify({ error: 'Query failed', details: queryError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to bePaid payments without receipt
    const candidates = orders?.filter(order => {
      const payments = order.payments_v2 as any[];
      const bepaidPayment = payments.find(p => 
        p.provider === 'bepaid' && 
        p.provider_payment_id &&
        p.status === 'succeeded'
      );
      
      if (!bepaidPayment) return false;
      if (only_missing_receipt && bepaidPayment.receipt_url) return false;
      
      return true;
    }) || [];

    console.log(`Found ${candidates.length} candidates for backfill`);

    const result: BackfillResult = {
      total: candidates.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    // Dry run - just return candidates
    if (dry_run) {
      result.candidates = candidates.map(c => ({
        order_id: c.id,
        order_number: c.order_number,
        customer_email: c.customer_email,
        created_at: c.created_at,
      }));

      return new Response(
        JSON.stringify({
          status: 'dry_run',
          message: `Found ${candidates.length} orders that would be processed`,
          ...result,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PATCH-P0.9.1: Strict creds
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(
        JSON.stringify({ 
          status: 'failed', 
          error: 'bePaid credentials not configured: ' + credsResult.error,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const bepaidCreds = credsResult;
    const authString = createBepaidAuthHeader(bepaidCreds).replace('Basic ', '');

    // Process each candidate
    for (const order of candidates) {
      const payments = order.payments_v2 as any[];
      const bepaidPayment = payments.find(p => 
        p.provider === 'bepaid' && 
        p.provider_payment_id &&
        p.status === 'succeeded'
      );

      if (!bepaidPayment) {
        result.skipped++;
        continue;
      }

      try {
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 150));

        const apiUrl = `https://gateway.bepaid.by/v2/transactions/${bepaidPayment.provider_payment_id}`;
        
        const apiResponse = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!apiResponse.ok) {
          const errorText = await apiResponse.text();
          result.failed++;
          result.errors.push({ 
            order_id: order.id, 
            error: `API ${apiResponse.status}: ${errorText.substring(0, 100)}` 
          });
          continue;
        }

        const txData = await apiResponse.json();
        const transaction = txData.transaction || txData;
        
        const receiptUrl = transaction.receipt_url || 
                          transaction.receipt?.url ||
                          transaction.links?.receipt ||
                          null;

        // Extract refunds
        const existingRefunds = (bepaidPayment.refunds || []) as any[];
        const refundOperations = transaction.refunds || 
                                transaction.child_transactions?.filter((t: any) => t.type === 'refund') ||
                                [];
        
        const newRefunds: any[] = [];
        for (const refund of refundOperations) {
          const refundId = refund.uid || refund.id;
          if (existingRefunds.find(r => r.refund_id === refundId)) continue;
          
          newRefunds.push({
            refund_id: refundId,
            amount: (refund.amount || 0) / 100,
            currency: refund.currency || 'BYN',
            status: refund.status === 'successful' ? 'succeeded' : refund.status,
            created_at: refund.created_at || new Date().toISOString(),
            receipt_url: refund.receipt_url || null,
            reason: refund.message || refund.reason || null,
          });
        }

        const allRefunds = [...existingRefunds, ...newRefunds];
        const totalRefunded = allRefunds
          .filter(r => r.status === 'succeeded')
          .reduce((sum, r) => sum + r.amount, 0);

        // Update payment
        const updateData: Record<string, any> = {
          provider_response: txData,
        };
        
        if (receiptUrl) {
          updateData.receipt_url = receiptUrl;
        }
        
        if (allRefunds.length > 0) {
          updateData.refunds = allRefunds;
          updateData.refunded_amount = totalRefunded;
          
          const lastRefundAt = allRefunds
            .filter(r => r.status === 'succeeded')
            .map(r => new Date(r.created_at).getTime())
            .sort((a, b) => b - a)[0];
          
          if (lastRefundAt) {
            updateData.refunded_at = new Date(lastRefundAt).toISOString();
          }
        }

        await supabase
          .from('payments_v2')
          .update(updateData)
          .eq('id', bepaidPayment.id);

        if (receiptUrl || newRefunds.length > 0) {
          result.updated++;
        } else {
          result.skipped++;
        }

      } catch (err) {
        result.failed++;
        result.errors.push({ 
          order_id: order.id, 
          error: String(err).substring(0, 100) 
        });
      }
    }

    // Log completion
    await supabase.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'bepaid_docs_backfill_completed',
      meta: { 
        since_days, 
        limit, 
        total: result.total,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      },
    });

    return new Response(
      JSON.stringify({
        status: 'completed',
        ...result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('bepaid-docs-backfill error:', error);
    return new Response(
      JSON.stringify({ status: 'failed', error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
