import { integrationOwnerDenial } from '../_shared/integration-owner-auth.ts';
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GetCourseConfig {
  account_name: string;
  secret_key: string;
}

interface SyncResult {
  entity_type: string;
  direction: string;
  imported: number;
  exported: number;
  errors: number;
  details: string[];
}

// GetCourse API helper
async function gcRequest(
  config: GetCourseConfig,
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<any> {
  const url = `https://${config.account_name}.getcourse.ru/pl/api/${endpoint}`;
  
  const formData = new FormData();
  formData.append('key', config.secret_key);
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const text = await response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    console.error('GetCourse response not JSON:', text.slice(0, 500));
    throw new Error('Invalid response from GetCourse');
  }
}

// Import users from GetCourse
async function importUsers(
  supabase: any,
  config: GetCourseConfig,
  instanceId: string,
  filters: Record<string, unknown>
): Promise<SyncResult> {
  const result: SyncResult = {
    entity_type: 'users',
    direction: 'import',
    imported: 0,
    exported: 0,
    errors: 0,
    details: [],
  };

  try {
    // Get users from GetCourse
    const gcParams: Record<string, unknown> = {};
    
    if (filters.created_from) {
      gcParams.created_at_from = filters.created_from;
    }
    if (filters.created_to) {
      gcParams.created_at_to = filters.created_to;
    }
    if (filters.group_ids && (filters.group_ids as number[]).length > 0) {
      gcParams.group_id = (filters.group_ids as number[])[0]; // GC only supports one group at a time
    }

    const response = await gcRequest(config, 'users', gcParams);

    if (!response.success) {
      throw new Error(response.error_message || 'Failed to fetch users');
    }

    const users = response.result?.items || [];
    result.details.push(`Fetched ${users.length} users from GetCourse`);

    // Get field mappings
    const { data: mappings } = await supabase
      .from('integration_field_mappings')
      .select('*')
      .eq('instance_id', instanceId)
      .eq('entity_type', 'users');

    const mappingMap: Record<string, string> = {};
    mappings?.forEach((m: any) => {
      mappingMap[m.external_field] = m.project_field;
    });

    for (const gcUser of users) {
      try {
        const email = gcUser.email?.toLowerCase();
        if (!email) {
          result.errors++;
          continue;
        }

        // Check if user exists
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, user_id')
          .eq('email', email)
          .maybeSingle();

        if (existingProfile) {
          // Update profile with GC data
          const updateData: Record<string, unknown> = {};
          
          if (gcUser.first_name) updateData.full_name = `${gcUser.first_name} ${gcUser.last_name || ''}`.trim();
          if (gcUser.phone) updateData.phone = gcUser.phone;

          if (Object.keys(updateData).length > 0) {
            await supabase
              .from('profiles')
              .update(updateData)
              .eq('id', existingProfile.id);
          }

          // Save field values based on mappings
          for (const [gcField, ourFieldId] of Object.entries(mappingMap)) {
            const value = gcUser[gcField];
            if (value !== undefined && value !== null) {
              await supabase
                .from('field_values')
                .upsert({
                  field_id: ourFieldId,
                  entity_type: 'client',
                  entity_id: existingProfile.id,
                  value_text: String(value),
                }, {
                  onConflict: 'field_id,entity_type,entity_id',
                });
            }
          }

          result.imported++;
        } else {
          // Log for manual review - we don't create auth users from imports
          result.details.push(`New user (no account): ${email}`);
        }

        // Log sync
        await supabase.from('integration_sync_logs').insert({
          instance_id: instanceId,
          entity_type: 'users',
          direction: 'import',
          object_id: String(gcUser.id),
          object_type: 'user',
          result: 'success',
          payload_meta: { email, gc_id: gcUser.id },
        });

      } catch (err) {
        result.errors++;
        console.error('Error importing user:', err);
      }
    }

  } catch (error) {
    result.errors++;
    result.details.push(`Error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return result;
}

// Export order to GetCourse
async function exportOrder(
  supabase: any,
  config: GetCourseConfig,
  instanceId: string,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get order data
    const { data: order, error } = await supabase
      .from('orders_v2')
      .select(`
        *,
        products_v2(name, code),
        tariffs(name, code),
        profiles!orders_v2_user_id_fkey(email, full_name, phone)
      `)
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return { success: false, error: 'Order not found' };
    }

    const profile = order.profiles as any;
    const product = order.products_v2 as any;
    
    if (!profile?.email) {
      return { success: false, error: 'No email for order' };
    }

    // Create deal in GetCourse
    const dealParams = {
      user: {
        email: profile.email,
        first_name: profile.full_name?.split(' ')[0] || '',
        last_name: profile.full_name?.split(' ').slice(1).join(' ') || '',
        phone: profile.phone || '',
      },
      deal: {
        deal_number: order.order_number,
        offer_code: product?.code || 'default',
        deal_cost: Number(order.final_price),
        deal_status: order.status === 'paid' ? 'payed' : 'new',
        payment_type: 'Безналичная оплата',
      },
    };

    const response = await gcRequest(config, 'deals', { params: dealParams });

    if (!response.success) {
      return { success: false, error: response.error_message || 'Failed to create deal' };
    }

    // Log sync
    await supabase.from('integration_sync_logs').insert({
      instance_id: instanceId,
      entity_type: 'orders',
      direction: 'export',
      object_id: orderId,
      object_type: 'order',
      result: 'success',
      payload_meta: { 
        order_number: order.order_number,
        gc_deal_id: response.result?.deal_id,
      },
    });

    return { success: true };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Import payments from GetCourse
async function importPayments(
  supabase: any,
  config: GetCourseConfig,
  instanceId: string,
  filters: Record<string, unknown>
): Promise<SyncResult> {
  const result: SyncResult = {
    entity_type: 'payments',
    direction: 'import',
    imported: 0,
    exported: 0,
    errors: 0,
    details: [],
  };

  try {
    const gcParams: Record<string, unknown> = {};
    
    if (filters.created_from) {
      gcParams.created_at_from = filters.created_from;
    }
    if (filters.created_to) {
      gcParams.created_at_to = filters.created_to;
    }

    const response = await gcRequest(config, 'payments', gcParams);

    if (!response.success) {
      throw new Error(response.error_message || 'Failed to fetch payments');
    }

    const payments = response.result?.items || [];
    result.details.push(`Fetched ${payments.length} payments from GetCourse`);

    for (const gcPayment of payments) {
      try {
        // Log the payment data for reference
        await supabase.from('integration_sync_logs').insert({
          instance_id: instanceId,
          entity_type: 'payments',
          direction: 'import',
          object_id: String(gcPayment.id),
          object_type: 'payment',
          result: 'success',
          payload_meta: { 
            amount: gcPayment.cost,
            status: gcPayment.status,
            user_email: gcPayment.user_email,
          },
        });

        result.imported++;
      } catch (err) {
        result.errors++;
      }
    }

  } catch (error) {
    result.errors++;
    result.details.push(`Error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  return result;
}

// Add user to offer - used when granting access via admin panel
async function addUserToOffer(
  supabase: any,
  config: GetCourseConfig,
  instanceId: string,
  userId: string,
  offerCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('email, full_name, phone')
      .eq('user_id', userId)
      .single();

    if (error || !profile?.email) {
      return { success: false, error: 'User not found or no email' };
    }

    // Create deal in GetCourse with the specified offer
    const dealParams = {
      user: {
        email: profile.email,
        first_name: profile.full_name?.split(' ')[0] || '',
        last_name: profile.full_name?.split(' ').slice(1).join(' ') || '',
        phone: profile.phone || '',
      },
      deal: {
        offer_code: offerCode,
        deal_status: 'payed',
        payment_type: 'Выдано вручную',
      },
    };

    console.log(`Adding user ${profile.email} to GetCourse offer ${offerCode}`);

    const response = await gcRequest(config, 'deals', { params: dealParams });

    if (!response.success) {
      console.error('GetCourse add to offer failed:', response);
      return { success: false, error: response.error_message || 'Failed to add user to offer' };
    }

    // Log sync
    await supabase.from('integration_sync_logs').insert({
      instance_id: instanceId,
      entity_type: 'access_grant',
      direction: 'export',
      object_id: userId,
      object_type: 'user',
      result: 'success',
      payload_meta: { 
        email: profile.email,
        offer_code: offerCode,
        gc_deal_id: response.result?.deal_id,
      },
    });

    console.log(`User ${profile.email} added to GetCourse offer ${offerCode}`);
    return { success: true };

  } catch (error) {
    console.error('Error adding user to offer:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const denial = await integrationOwnerDenial(req, supabase, supabaseServiceKey);
    if (denial) return new Response(JSON.stringify({ error: denial.error }), {
      status: denial.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const body = await req.json();
    const { instance_id, action, order_id, user_id, offer_code } = body;

    // Get GetCourse instance - either specified or default
    let instanceQuery = supabase
      .from('integration_instances')
      .select('*')
      .eq('provider', 'getcourse')
      .eq('status', 'active');
    
    if (instance_id) {
      instanceQuery = instanceQuery.eq('id', instance_id);
    } else {
      instanceQuery = instanceQuery.eq('is_default', true);
    }

    const { data: instance, error: instanceError } = await instanceQuery.maybeSingle();

    if (instanceError || !instance) {
      // Try to get any active instance
      const { data: anyInstance } = await supabase
        .from('integration_instances')
        .select('*')
        .eq('provider', 'getcourse')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (!anyInstance) {
        console.log('No GetCourse instance configured');
        // Return 200 so callers don't crash on non-2xx. Caller should check success flag.
        return new Response(JSON.stringify({ success: false, error: 'GetCourse not configured' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const finalInstance = instance || (await supabase
      .from('integration_instances')
      .select('*')
      .eq('provider', 'getcourse')
      .eq('status', 'active')
      .limit(1)
      .single()).data;

    if (!finalInstance) {
      return new Response(JSON.stringify({ success: false, error: 'GetCourse not configured' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config: GetCourseConfig = {
      account_name: (finalInstance.config as any)?.account_name || '',
      secret_key: (finalInstance.config as any)?.secret_key || '',
    };

    if (!config.account_name || !config.secret_key) {
      return new Response(JSON.stringify({ success: false, error: 'GetCourse credentials not configured' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle specific actions
    if (action === 'export-order' && order_id) {
      const result = await exportOrder(supabase, config, finalInstance.id, order_id);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Add user to offer
    if (action === 'add_user_to_offer' && user_id && offer_code) {
      const result = await addUserToOffer(supabase, config, finalInstance.id, user_id, offer_code);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Full sync - get sync settings
    const { data: syncSettings } = await supabase
      .from('integration_sync_settings')
      .select('*')
      .eq('instance_id', finalInstance.id)
      .eq('is_enabled', true);

    const results: SyncResult[] = [];

    for (const setting of syncSettings || []) {
      const filters = (setting.filters || {}) as Record<string, unknown>;

      if (setting.entity_type === 'users' && 
          (setting.direction === 'import' || setting.direction === 'bidirectional')) {
        const result = await importUsers(supabase, config, finalInstance.id, filters);
        results.push(result);
      }

      if (setting.entity_type === 'payments' && 
          (setting.direction === 'import' || setting.direction === 'bidirectional')) {
        const result = await importPayments(supabase, config, finalInstance.id, filters);
        results.push(result);
      }
    }

    // Update last sync time
    await supabase
      .from('integration_instances')
      .update({ last_check_at: new Date().toISOString() })
      .eq('id', finalInstance.id);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('GetCourse sync error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
