import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AmoCRMWebhookPayload {
  leads?: {
    add?: Array<{
      id: string;
      name: string;
      status_id: string;
      pipeline_id: string;
      price: string;
      custom_fields?: Array<{
        id: string;
        name: string;
        values: Array<{ value: string }>;
      }>;
    }>;
    update?: Array<{
      id: string;
      name: string;
      status_id: string;
      pipeline_id: string;
      price: string;
      custom_fields?: Array<{
        id: string;
        name: string;
        values: Array<{ value: string }>;
      }>;
    }>;
    status?: Array<{
      id: string;
      status_id: string;
      pipeline_id: string;
      old_status_id: string;
      old_pipeline_id: string;
    }>;
  };
  contacts?: {
    add?: Array<{
      id: string;
      name: string;
      custom_fields?: Array<{
        id: string;
        name: string;
        values: Array<{ value: string }>;
      }>;
    }>;
    update?: Array<{
      id: string;
      name: string;
      custom_fields?: Array<{
        id: string;
        name: string;
        values: Array<{ value: string }>;
      }>;
    }>;
  };
  account?: {
    id: string;
    subdomain: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Received amoCRM webhook');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse the webhook payload
    let payload: AmoCRMWebhookPayload;
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      payload = {};
      
      // Parse form data into nested object structure
      for (const [key, value] of formData.entries()) {
        console.log(`Form field: ${key} = ${value}`);
        // amoCRM sends data in format like leads[add][0][id]
        // We'll store the raw data for now
      }
      
      // For form data, try to reconstruct the payload
      const rawPayload: Record<string, any> = {};
      for (const [key, value] of formData.entries()) {
        rawPayload[key] = value;
      }
      console.log('Raw form payload:', JSON.stringify(rawPayload));
      payload = rawPayload as any;
    } else {
      payload = await req.json().catch(() => ({}));
    }

    console.log('Webhook payload:', JSON.stringify(payload));

    // Log the webhook to audit_logs for tracking
    await supabaseClient.from('audit_logs').insert({
      action: 'amocrm_webhook',
      actor_user_id: '00000000-0000-0000-0000-000000000000', // System user
      meta: {
        payload,
        received_at: new Date().toISOString(),
      }
    });

    // Process lead status changes
    if (payload.leads?.status) {
      for (const lead of payload.leads.status) {
        console.log(`Lead ${lead.id} status changed from ${lead.old_status_id} to ${lead.status_id}`);
        
        // Here you can add logic to update subscription status based on deal stage
        // For example, if deal moves to "success" stage, activate subscription
      }
    }

    // Process new leads
    if (payload.leads?.add) {
      for (const lead of payload.leads.add) {
        console.log(`New lead created: ${lead.id} - ${lead.name}`);
      }
    }

    // Process lead updates
    if (payload.leads?.update) {
      for (const lead of payload.leads.update) {
        console.log(`Lead updated: ${lead.id} - ${lead.name}`);
      }
    }

    // Process new contacts
    if (payload.contacts?.add) {
      for (const contact of payload.contacts.add) {
        console.log(`New contact created: ${contact.id} - ${contact.name}`);
      }
    }

    // Process contact updates
    if (payload.contacts?.update) {
      for (const contact of payload.contacts.update) {
        console.log(`Contact updated: ${contact.id} - ${contact.name}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
