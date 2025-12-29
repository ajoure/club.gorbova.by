import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AmoCRMEntity {
  id: string;
  name?: string;
  status_id?: string;
  pipeline_id?: string;
  price?: string;
  responsible_user_id?: string;
  created_at?: number;
  updated_at?: number;
  custom_fields_values?: Array<{
    field_id: number;
    field_name: string;
    values: Array<{ value: string; enum_id?: number }>;
  }>;
}

interface AmoCRMWebhookPayload {
  leads?: {
    add?: AmoCRMEntity[];
    update?: AmoCRMEntity[];
    status?: Array<{
      id: string;
      status_id: string;
      pipeline_id: string;
      old_status_id: string;
      old_pipeline_id: string;
    }>;
  };
  contacts?: {
    add?: AmoCRMEntity[];
    update?: AmoCRMEntity[];
  };
  companies?: {
    add?: AmoCRMEntity[];
    update?: AmoCRMEntity[];
  };
  account?: {
    id: string;
    subdomain: string;
  };
}

// Parse amoCRM form data into structured payload
function parseFormData(formData: FormData): AmoCRMWebhookPayload {
  const payload: AmoCRMWebhookPayload = {};
  const rawData: Record<string, any> = {};
  
  for (const [key, value] of formData.entries()) {
    // Parse nested keys like leads[add][0][id]
    const match = key.match(/^(\w+)\[(\w+)\]\[(\d+)\]\[(\w+)\](?:\[(\d+)\])?(?:\[(\w+)\])?$/);
    if (match) {
      const [, entity, action, index, field, subIndex, subField] = match;
      
      if (!rawData[entity]) rawData[entity] = {};
      if (!rawData[entity][action]) rawData[entity][action] = [];
      if (!rawData[entity][action][parseInt(index)]) rawData[entity][action][parseInt(index)] = {};
      
      if (subIndex !== undefined && subField !== undefined) {
        if (!rawData[entity][action][parseInt(index)][field]) {
          rawData[entity][action][parseInt(index)][field] = [];
        }
        if (!rawData[entity][action][parseInt(index)][field][parseInt(subIndex)]) {
          rawData[entity][action][parseInt(index)][field][parseInt(subIndex)] = {};
        }
        rawData[entity][action][parseInt(index)][field][parseInt(subIndex)][subField] = value;
      } else {
        rawData[entity][action][parseInt(index)][field] = value;
      }
    }
  }
  
  // Convert arrays and clean up
  if (rawData.leads) {
    payload.leads = {};
    if (rawData.leads.add) payload.leads.add = Object.values(rawData.leads.add).filter(Boolean) as AmoCRMEntity[];
    if (rawData.leads.update) payload.leads.update = Object.values(rawData.leads.update).filter(Boolean) as AmoCRMEntity[];
    if (rawData.leads.status) payload.leads.status = Object.values(rawData.leads.status).filter(Boolean) as any[];
  }
  
  if (rawData.contacts) {
    payload.contacts = {};
    if (rawData.contacts.add) payload.contacts.add = Object.values(rawData.contacts.add).filter(Boolean) as AmoCRMEntity[];
    if (rawData.contacts.update) payload.contacts.update = Object.values(rawData.contacts.update).filter(Boolean) as AmoCRMEntity[];
  }
  
  if (rawData.companies) {
    payload.companies = {};
    if (rawData.companies.add) payload.companies.add = Object.values(rawData.companies.add).filter(Boolean) as AmoCRMEntity[];
    if (rawData.companies.update) payload.companies.update = Object.values(rawData.companies.update).filter(Boolean) as AmoCRMEntity[];
  }
  
  return payload;
}

// Find integration instance by amoCRM subdomain
async function findInstanceBySubdomain(supabase: any, subdomain: string) {
  const { data: instances } = await supabase
    .from('integration_instances')
    .select('*')
    .eq('provider', 'amocrm')
    .eq('status', 'connected');
  
  if (!instances) return null;
  
  for (const instance of instances) {
    const config = instance.config as Record<string, any>;
    if (config?.subdomain === subdomain || config?.subdomain?.includes(subdomain)) {
      return instance;
    }
  }
  
  return instances[0] || null; // Fallback to first instance
}

// Get field mappings for entity type
async function getFieldMappings(supabase: any, instanceId: string, entityType: string) {
  const { data } = await supabase
    .from('integration_field_mappings')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('entity_type', entityType);
  
  return data || [];
}

// Apply field mappings to transform amoCRM data to project format
function applyMappings(entity: AmoCRMEntity, mappings: any[]): Record<string, any> {
  const result: Record<string, any> = {
    external_id: entity.id,
    raw_data: entity,
  };
  
  for (const mapping of mappings) {
    let value: any = null;
    
    // Handle standard fields
    if (entity[mapping.external_field as keyof AmoCRMEntity] !== undefined) {
      value = entity[mapping.external_field as keyof AmoCRMEntity];
    }
    
    // Handle custom fields
    if (mapping.external_field.startsWith('cf_') && entity.custom_fields_values) {
      const fieldId = mapping.external_field.replace('cf_', '');
      const customField = entity.custom_fields_values.find(
        cf => cf.field_id.toString() === fieldId || cf.field_name === fieldId
      );
      if (customField && customField.values.length > 0) {
        value = customField.values[0].value;
      }
    }
    
    if (value !== null) {
      result[mapping.project_field] = value;
    }
  }
  
  return result;
}

// Log sync event
async function logSyncEvent(
  supabase: any, 
  instanceId: string, 
  entityType: string, 
  result: string, 
  payload: any,
  errorMessage?: string
) {
  await supabase.from('integration_sync_logs').insert({
    instance_id: instanceId,
    entity_type: entityType,
    direction: 'inbound',
    result,
    payload_meta: payload,
    error_message: errorMessage,
  });
}

// Sync contact to profiles table
async function syncContact(supabase: any, instanceId: string, contact: AmoCRMEntity, action: string) {
  const mappings = await getFieldMappings(supabase, instanceId, 'contacts');
  const mappedData = applyMappings(contact, mappings);
  
  console.log(`Syncing contact ${contact.id} (${action}):`, mappedData);
  
  // Try to find existing profile by external data
  let existingProfile = null;
  if (mappedData.email) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', mappedData.email)
      .maybeSingle();
    existingProfile = data;
  } else if (mappedData.phone) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', mappedData.phone)
      .maybeSingle();
    existingProfile = data;
  }
  
  // Update or log for manual review
  if (existingProfile) {
    const updateData: Record<string, any> = {};
    if (mappedData.full_name && !existingProfile.full_name) {
      updateData.full_name = mappedData.full_name;
    }
    if (mappedData.phone && !existingProfile.phone) {
      updateData.phone = mappedData.phone;
    }
    
    if (Object.keys(updateData).length > 0) {
      await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', existingProfile.id);
      
      console.log(`Updated profile ${existingProfile.id} with amoCRM data`);
    }
  }
  
  await logSyncEvent(supabase, instanceId, 'contacts', 'success', {
    external_id: contact.id,
    action,
    mapped_data: mappedData,
    matched_profile: existingProfile?.id,
  });
}

// Sync deal to orders/entitlements
async function syncDeal(supabase: any, instanceId: string, lead: AmoCRMEntity, action: string) {
  const mappings = await getFieldMappings(supabase, instanceId, 'deals');
  const mappedData = applyMappings(lead, mappings);
  
  console.log(`Syncing deal ${lead.id} (${action}):`, mappedData);
  
  // Log the sync event for now - actual order creation would need more business logic
  await logSyncEvent(supabase, instanceId, 'deals', 'success', {
    external_id: lead.id,
    action,
    status_id: lead.status_id,
    pipeline_id: lead.pipeline_id,
    price: lead.price,
    mapped_data: mappedData,
  });
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
      payload = parseFormData(formData);
    } else {
      payload = await req.json().catch(() => ({}));
    }

    console.log('Parsed webhook payload:', JSON.stringify(payload));

    // Find the integration instance
    const subdomain = payload.account?.subdomain || '';
    const instance = await findInstanceBySubdomain(supabaseClient, subdomain);
    
    if (!instance) {
      console.log('No matching amoCRM integration instance found');
      return new Response(
        JSON.stringify({ success: true, message: 'No matching instance' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found instance: ${instance.id} (${instance.alias})`);

    // Log to audit_logs
    await supabaseClient.from('audit_logs').insert({
      action: 'amocrm_webhook',
      actor_user_id: '00000000-0000-0000-0000-000000000000',
      meta: {
        instance_id: instance.id,
        payload,
        received_at: new Date().toISOString(),
      }
    });

    // Process contacts
    if (payload.contacts?.add) {
      for (const contact of payload.contacts.add) {
        await syncContact(supabaseClient, instance.id, contact, 'add');
      }
    }
    
    if (payload.contacts?.update) {
      for (const contact of payload.contacts.update) {
        await syncContact(supabaseClient, instance.id, contact, 'update');
      }
    }

    // Process deals (leads)
    if (payload.leads?.add) {
      for (const lead of payload.leads.add) {
        await syncDeal(supabaseClient, instance.id, lead, 'add');
      }
    }
    
    if (payload.leads?.update) {
      for (const lead of payload.leads.update) {
        await syncDeal(supabaseClient, instance.id, lead, 'update');
      }
    }
    
    if (payload.leads?.status) {
      for (const statusChange of payload.leads.status) {
        console.log(`Deal ${statusChange.id} status changed: ${statusChange.old_status_id} -> ${statusChange.status_id}`);
        
        await logSyncEvent(supabaseClient, instance.id, 'deals', 'success', {
          external_id: statusChange.id,
          action: 'status_change',
          old_status_id: statusChange.old_status_id,
          new_status_id: statusChange.status_id,
          pipeline_id: statusChange.pipeline_id,
        });
      }
    }

    // Process companies
    if (payload.companies?.add) {
      for (const company of payload.companies.add) {
        console.log(`New company: ${company.id} - ${company.name}`);
        await logSyncEvent(supabaseClient, instance.id, 'companies', 'success', {
          external_id: company.id,
          action: 'add',
          name: company.name,
        });
      }
    }
    
    if (payload.companies?.update) {
      for (const company of payload.companies.update) {
        console.log(`Company updated: ${company.id} - ${company.name}`);
        await logSyncEvent(supabaseClient, instance.id, 'companies', 'success', {
          external_id: company.id,
          action: 'update',
          name: company.name,
        });
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
