import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { instance_id, provider, config, entity_type, direction } = await req.json();

    console.log(`Starting sync for instance ${instance_id}, provider: ${provider}`);

    // Fetch sync settings for this instance
    const { data: syncSettings, error: settingsError } = await supabase
      .from('integration_sync_settings')
      .select('*')
      .eq('instance_id', instance_id)
      .eq('is_enabled', true);

    if (settingsError) {
      throw new Error(`Failed to fetch sync settings: ${settingsError.message}`);
    }

    const settingsToSync = entity_type 
      ? syncSettings?.filter(s => s.entity_type === entity_type)
      : syncSettings;

    if (!settingsToSync || settingsToSync.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No enabled sync settings found' 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Fetch field mappings for this instance
    const { data: fieldMappings } = await supabase
      .from('integration_field_mappings')
      .select('*')
      .eq('instance_id', instance_id);

    const results = [];

    for (const setting of settingsToSync) {
      const entityMappings = fieldMappings?.filter(m => m.entity_type === setting.entity_type) || [];
      
      try {
        let result;
        
        if (provider === 'getcourse') {
          result = await syncGetCourse(config, setting, entityMappings, supabase, instance_id);
        } else if (provider === 'amocrm') {
          result = await syncAmoCRM(config, setting, entityMappings, supabase, instance_id);
        } else {
          throw new Error(`Unknown provider: ${provider}`);
        }
        
        results.push({ entity: setting.entity_type, ...result });
        
        // Log success
        await logSync(supabase, instance_id, setting.entity_type, setting.direction, 'success', null, result);
        
      } catch (entityError) {
        const message = entityError instanceof Error ? entityError.message : 'Unknown error';
        console.error(`Error syncing ${setting.entity_type}:`, message);
        results.push({ entity: setting.entity_type, error: message });
        
        // Log error
        await logSync(supabase, instance_id, setting.entity_type, setting.direction, 'error', message, null);
      }
    }

    // Update last_sync_at for processed settings
    for (const setting of settingsToSync) {
      await supabase
        .from('integration_sync_settings')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', setting.id);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sync error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function logSync(
  supabase: any, 
  instanceId: string, 
  entityType: string, 
  direction: string, 
  result: string, 
  errorMessage: string | null,
  meta: any
) {
  await supabase.from('integration_sync_logs').insert({
    instance_id: instanceId,
    entity_type: entityType,
    direction,
    result,
    error_message: errorMessage,
    payload_meta: meta || {},
  });
}

// ============= GetCourse Sync =============
async function syncGetCourse(
  config: any, 
  setting: any, 
  mappings: any[], 
  supabase: any,
  instanceId: string
) {
  const accountName = config?.account_name;
  const secretKey = config?.secret_key;
  
  if (!accountName || !secretKey) {
    throw new Error('GetCourse credentials not configured');
  }

  const baseUrl = `https://${accountName}.getcourse.ru/pl/api`;
  const filters = setting.filters || {};
  
  let imported = 0;
  let exported = 0;

  if (setting.direction === 'import' || setting.direction === 'bidirectional') {
    if (setting.entity_type === 'users') {
      imported = await importGetCourseUsers(baseUrl, secretKey, filters, mappings, supabase);
    } else if (setting.entity_type === 'orders') {
      imported = await importGetCourseOrders(baseUrl, secretKey, filters, mappings, supabase);
    } else if (setting.entity_type === 'payments') {
      imported = await importGetCoursePayments(baseUrl, secretKey, filters, mappings, supabase);
    } else if (setting.entity_type === 'groups') {
      imported = await importGetCourseGroups(baseUrl, secretKey, filters, supabase);
    }
  }

  if (setting.direction === 'export' || setting.direction === 'bidirectional') {
    if (setting.entity_type === 'users') {
      exported = await exportToGetCourseUsers(baseUrl, secretKey, mappings, supabase);
    }
  }

  return { imported, exported };
}

async function makeGetCourseRequest(baseUrl: string, secretKey: string, endpoint: string, params: any = {}) {
  const url = `${baseUrl}/${endpoint}`;
  
  const body = new URLSearchParams();
  body.append('key', secretKey);
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`GetCourse API error: ${response.status}`);
  }

  return response.json();
}

async function importGetCourseUsers(baseUrl: string, secretKey: string, filters: any, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    const params: any = { action: 'getList' };
    
    // Apply filters
    if (filters.created_from) {
      params['created_at[from]'] = filters.created_from;
    }
    if (filters.created_to) {
      params['created_at[to]'] = filters.created_to;
    }

    const result = await makeGetCourseRequest(baseUrl, secretKey, 'users', params);
    
    if (result.success && result.info?.items) {
      for (const user of result.info.items) {
        const email = user.email;
        if (!email) continue;

        // Check if profile exists
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (!existingProfile) {
          // Create new profile (would need auth user first in real scenario)
          console.log(`Would import user: ${email}`);
        }
        count++;
      }
    }
  } catch (error) {
    console.error('Error importing GetCourse users:', error);
    throw error;
  }

  return count;
}

async function importGetCourseOrders(baseUrl: string, secretKey: string, filters: any, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    const params: any = { action: 'getList' };
    
    // Apply filters
    if (filters.status) {
      params['status'] = filters.status;
    }
    if (filters.created_from) {
      params['created_at[from]'] = filters.created_from;
    }
    if (filters.created_to) {
      params['created_at[to]'] = filters.created_to;
    }

    const result = await makeGetCourseRequest(baseUrl, secretKey, 'deals', params);
    
    if (result.success && result.info?.items) {
      count = result.info.items.length;
      console.log(`Found ${count} orders to sync from GetCourse`);
    }
  } catch (error) {
    console.error('Error importing GetCourse orders:', error);
    throw error;
  }

  return count;
}

async function importGetCoursePayments(baseUrl: string, secretKey: string, filters: any, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    const params: any = { action: 'getList' };
    
    // Apply filters
    if (filters.payment_type) {
      params['type'] = filters.payment_type;
    }
    if (filters.created_from) {
      params['created_at[from]'] = filters.created_from;
    }
    if (filters.created_to) {
      params['created_at[to]'] = filters.created_to;
    }

    const result = await makeGetCourseRequest(baseUrl, secretKey, 'payments', params);
    
    if (result.success && result.info?.items) {
      count = result.info.items.length;
      console.log(`Found ${count} payments to sync from GetCourse`);
    }
  } catch (error) {
    console.error('Error importing GetCourse payments:', error);
    throw error;
  }

  return count;
}

async function importGetCourseGroups(baseUrl: string, secretKey: string, filters: any, supabase: any) {
  let count = 0;
  
  try {
    const result = await makeGetCourseRequest(baseUrl, secretKey, 'groups', { action: 'getList' });
    
    if (result.success && result.info?.items) {
      count = result.info.items.length;
      console.log(`Found ${count} groups from GetCourse`);
    }
  } catch (error) {
    console.error('Error importing GetCourse groups:', error);
    throw error;
  }

  return count;
}

async function exportToGetCourseUsers(baseUrl: string, secretKey: string, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    // Get profiles to export
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .not('email', 'is', null)
      .limit(100);

    if (profiles) {
      for (const profile of profiles) {
        // Export user to GetCourse
        const params = {
          action: 'add',
          email: profile.email,
          first_name: profile.full_name?.split(' ')[0] || '',
          last_name: profile.full_name?.split(' ').slice(1).join(' ') || '',
          phone: profile.phone || '',
        };

        try {
          await makeGetCourseRequest(baseUrl, secretKey, 'users', params);
          count++;
        } catch (e) {
          console.log(`Failed to export user ${profile.email}:`, e);
        }
      }
    }
  } catch (error) {
    console.error('Error exporting to GetCourse:', error);
    throw error;
  }

  return count;
}

// ============= amoCRM Sync =============
async function syncAmoCRM(
  config: any, 
  setting: any, 
  mappings: any[], 
  supabase: any,
  instanceId: string
) {
  let subdomain = config?.subdomain || '';
  const token = config?.long_term_token;
  
  if (!subdomain || !token) {
    throw new Error('amoCRM credentials not configured');
  }

  // Clean subdomain
  subdomain = subdomain.replace(/\.amocrm\.(ru|com)$/i, '').trim();
  const baseUrl = `https://${subdomain}.amocrm.ru/api/v4`;
  
  let imported = 0;
  let exported = 0;

  if (setting.direction === 'import' || setting.direction === 'bidirectional') {
    if (setting.entity_type === 'contacts') {
      imported = await importAmoCRMContacts(baseUrl, token, setting.filters, mappings, supabase);
    } else if (setting.entity_type === 'companies') {
      imported = await importAmoCRMCompanies(baseUrl, token, setting.filters, supabase);
    } else if (setting.entity_type === 'deals') {
      imported = await importAmoCRMDeals(baseUrl, token, setting.filters, supabase);
    }
  }

  if (setting.direction === 'export' || setting.direction === 'bidirectional') {
    if (setting.entity_type === 'contacts') {
      exported = await exportToAmoCRMContacts(baseUrl, token, mappings, supabase);
    }
  }

  return { imported, exported };
}

async function makeAmoCRMRequest(baseUrl: string, token: string, endpoint: string, params: any = {}) {
  const url = new URL(`${baseUrl}/${endpoint}`);
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`amoCRM API error: ${response.status}`);
  }

  return response.json();
}

async function importAmoCRMContacts(baseUrl: string, token: string, filters: any, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    const params: any = { limit: 250 };
    
    // Apply filters
    if (filters.pipeline_id) {
      params['filter[pipeline_id]'] = filters.pipeline_id;
    }
    if (filters.tags) {
      params['filter[tags]'] = filters.tags;
    }

    const result = await makeAmoCRMRequest(baseUrl, token, 'contacts', params);
    
    if (result._embedded?.contacts) {
      count = result._embedded.contacts.length;
      console.log(`Found ${count} contacts from amoCRM`);
    }
  } catch (error) {
    console.error('Error importing amoCRM contacts:', error);
    throw error;
  }

  return count;
}

async function importAmoCRMCompanies(baseUrl: string, token: string, filters: any, supabase: any) {
  let count = 0;
  
  try {
    const result = await makeAmoCRMRequest(baseUrl, token, 'companies', { limit: 250 });
    
    if (result._embedded?.companies) {
      count = result._embedded.companies.length;
      console.log(`Found ${count} companies from amoCRM`);
    }
  } catch (error) {
    console.error('Error importing amoCRM companies:', error);
    throw error;
  }

  return count;
}

async function importAmoCRMDeals(baseUrl: string, token: string, filters: any, supabase: any) {
  let count = 0;
  
  try {
    const params: any = { limit: 250 };
    
    // Apply filters
    if (filters.pipeline_id) {
      params['filter[pipeline_id]'] = filters.pipeline_id;
    }
    if (filters.status_id) {
      params['filter[statuses][0][pipeline_id]'] = filters.pipeline_id;
      params['filter[statuses][0][status_id]'] = filters.status_id;
    }

    const result = await makeAmoCRMRequest(baseUrl, token, 'leads', params);
    
    if (result._embedded?.leads) {
      count = result._embedded.leads.length;
      console.log(`Found ${count} deals from amoCRM`);
    }
  } catch (error) {
    console.error('Error importing amoCRM deals:', error);
    throw error;
  }

  return count;
}

async function exportToAmoCRMContacts(baseUrl: string, token: string, mappings: any[], supabase: any) {
  let count = 0;
  
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .not('email', 'is', null)
      .limit(100);

    if (profiles) {
      for (const profile of profiles) {
        const contactData = [{
          name: profile.full_name || profile.email,
          custom_fields_values: [
            {
              field_code: 'EMAIL',
              values: [{ value: profile.email }]
            }
          ]
        }];

        if (profile.phone) {
          contactData[0].custom_fields_values.push({
            field_code: 'PHONE',
            values: [{ value: profile.phone }]
          });
        }

        try {
          const response = await fetch(`${baseUrl}/contacts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(contactData),
          });

          if (response.ok) {
            count++;
          }
        } catch (e) {
          console.log(`Failed to export contact ${profile.email}:`, e);
        }
      }
    }
  } catch (error) {
    console.error('Error exporting to amoCRM:', error);
    throw error;
  }

  return count;
}
