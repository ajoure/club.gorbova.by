import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBepaidCredsStrict, createBepaidAuthHeader, isBepaidCredsError, type BepaidCreds } from '../_shared/bepaid-credentials.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FetchReceiptRequest {
  payment_id?: string;
  provider_payment_id?: string;
}

interface FetchReceiptResult {
  success: boolean;
  receipt_url?: string | null;
  error?: string;
  payment_id?: string;
}

// PATCH-P0.9: Removed custom getBepaidCredentials() with env fallback

async function fetchReceiptFromBepaid(
  transactionUid: string,
  creds: BepaidCreds
): Promise<{ receipt_url?: string; fee?: number; error?: string }> {
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
      const errorText = await response.text();
      console.error(`bePaid API error: ${response.status} - ${errorText}`);
      return { error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const transaction = data?.transaction;

    if (!transaction) {
      return { error: 'No transaction in response' };
    }

    // Extract receipt_url - it may be in different places
    const receiptUrl = transaction.receipt_url || 
                       transaction.payment?.receipt_url ||
                       transaction.authorization?.receipt_url;

    // Extract fee if available
    const fee = transaction.fee?.amount || 
                transaction.payment?.fee?.amount ||
                null;

    return { 
      receipt_url: receiptUrl || null,
      fee: fee ? Number(fee) / 100 : undefined // Convert from cents
    };
  } catch (error) {
    console.error('Error fetching from bePaid:', error);
    return { error: String(error) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: FetchReceiptRequest = await req.json();
    const { payment_id, provider_payment_id } = body;

    if (!payment_id && !provider_payment_id) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Either payment_id or provider_payment_id is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PATCH-P0.9: Get bePaid credentials STRICTLY from integration_instances
    const credsResult = await getBepaidCredsStrict(supabase);
    if (isBepaidCredsError(credsResult)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: credsResult.error 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const credentials = credsResult;

    let paymentData: any = null;
    let transactionUid = provider_payment_id;

    // If payment_id provided, fetch the payment record
    if (payment_id) {
      const { data: payment, error } = await supabase
        .from('payments_v2')
        .select('id, provider_payment_id, receipt_url, status')
        .eq('id', payment_id)
        .single();

      if (error || !payment) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Payment not found' 
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      paymentData = payment;
      transactionUid = payment.provider_payment_id;

      // If already has receipt_url, return it
      if (payment.receipt_url) {
        return new Response(JSON.stringify({ 
          success: true, 
          receipt_url: payment.receipt_url,
          payment_id: payment.id,
          message: 'Receipt already exists'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!transactionUid) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No provider_payment_id available' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch receipt from bePaid
    console.log(`Fetching receipt for transaction: ${transactionUid}`);
    const result = await fetchReceiptFromBepaid(transactionUid, credentials);

    if (result.error) {
      console.error(`Failed to fetch receipt: ${result.error}`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: result.error 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If we have a payment_id and got a receipt_url, update the payment
    if (payment_id && result.receipt_url) {
      const updateData: Record<string, any> = { receipt_url: result.receipt_url };
      
      // Also update fee if available
      if (result.fee !== undefined && paymentData) {
        const existingResponse = paymentData.provider_response || {};
        updateData.provider_response = {
          ...existingResponse,
          bepaid_fee: result.fee,
        };
      }

      const { error: updateError } = await supabase
        .from('payments_v2')
        .update(updateData)
        .eq('id', payment_id);

      if (updateError) {
        console.error(`Failed to update payment: ${updateError.message}`);
      } else {
        console.log(`Updated payment ${payment_id} with receipt_url: ${result.receipt_url}`);
      }
    }

    const response: FetchReceiptResult = {
      success: true,
      receipt_url: result.receipt_url,
      payment_id: payment_id || undefined,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in bepaid-fetch-receipt:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: String(error) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
