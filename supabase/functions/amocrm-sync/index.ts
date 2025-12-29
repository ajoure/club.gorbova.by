import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AmoCRMContact {
  name: string;
  first_name?: string;
  last_name?: string;
  custom_fields_values?: Array<{
    field_id: number;
    values: Array<{ value: string }>;
  }>;
}

interface AmoCRMDeal {
  name: string;
  price?: number;
  pipeline_id?: number;
  status_id?: number;
  custom_fields_values?: Array<{
    field_id: number;
    values: Array<{ value: string }>;
  }>;
  _embedded?: {
    contacts?: Array<{ id: number }>;
  };
}

function normalizeAmoCRMSubdomain(raw: string): string {
  const trimmed = raw.trim();

  // If a full amoCRM URL/host was provided, extract the subdomain from it.
  // Example: "https://ajoure.amocrm.ru" -> "ajoure"
  const match = trimmed.match(/([a-z0-9-]+)\.amocrm\.(ru|com)/i);
  if (match?.[1]) return match[1].toLowerCase();

  // Handle malformed protocol like "https//ajoure.amocrm.ru" (missing colon)
  const withoutProto = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^https?\/\//i, '');

  const host = withoutProto.split('/')[0];
  return host.split('.')[0].toLowerCase();
}

async function makeAmoCRMRequest(
  endpoint: string,
  method: string = 'GET',
  body?: object
): Promise<Response> {
  const accessToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const subdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN') || '';
  const subdomain = normalizeAmoCRMSubdomain(subdomainRaw);

  if (!accessToken || !subdomain) {
    throw new Error('AmoCRM credentials not configured');
  }

  const url = `https://${subdomain}.amocrm.ru/api/v4${endpoint}`;
  console.log(`Making AmoCRM request: ${method} ${url}`);


  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  console.log(`AmoCRM response status: ${response.status}`);
  
  return response;
}

async function findContactByEmail(email: string): Promise<number | null> {
  const response = await makeAmoCRMRequest(`/contacts?query=${encodeURIComponent(email)}`);
  
  if (!response.ok) {
    console.log('Contact search failed:', await response.text());
    return null;
  }

  const data = await response.json();
  if (data._embedded?.contacts?.length > 0) {
    return data._embedded.contacts[0].id;
  }
  return null;
}

async function findContactByPhone(phone: string): Promise<number | null> {
  const cleanPhone = phone.replace(/\D/g, '');
  const response = await makeAmoCRMRequest(`/contacts?query=${encodeURIComponent(cleanPhone)}`);
  
  if (!response.ok) {
    console.log('Contact search by phone failed:', await response.text());
    return null;
  }

  const data = await response.json();
  if (data._embedded?.contacts?.length > 0) {
    return data._embedded.contacts[0].id;
  }
  return null;
}

async function createContact(
  name: string,
  email: string,
  phone?: string
): Promise<number | null> {
  // First check if contact already exists
  let contactId = await findContactByEmail(email);
  if (contactId) {
    console.log(`Contact already exists with id: ${contactId}`);
    return contactId;
  }

  if (phone) {
    contactId = await findContactByPhone(phone);
    if (contactId) {
      console.log(`Contact found by phone with id: ${contactId}`);
      return contactId;
    }
  }

  const contactData: AmoCRMContact[] = [{
    name: name || email.split('@')[0],
    custom_fields_values: [
      {
        field_id: 0, // Will be replaced with actual email field id
        values: [{ value: email }]
      }
    ]
  }];

  // Get account info to find custom field IDs
  const accountResponse = await makeAmoCRMRequest('/account?with=custom_fields');
  let emailFieldId = 0;
  let phoneFieldId = 0;

  if (accountResponse.ok) {
    // Standard field IDs for email and phone in amoCRM
    // These are usually predefined, but we'll use the standard approach
    emailFieldId = 413855; // Standard email field
    phoneFieldId = 413853; // Standard phone field
  }

  // Build contact with proper fields
  const contact: AmoCRMContact = {
    name: name || email.split('@')[0],
    custom_fields_values: []
  };

  // Add email
  contact.custom_fields_values!.push({
    field_id: emailFieldId,
    values: [{ value: email }]
  });

  // Add phone if provided
  if (phone) {
    contact.custom_fields_values!.push({
      field_id: phoneFieldId,
      values: [{ value: phone }]
    });
  }

  const response = await makeAmoCRMRequest('/contacts', 'POST', [contact]);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to create contact:', errorText);
    throw new Error(`Failed to create contact: ${errorText}`);
  }

  const data = await response.json();
  console.log('Contact created:', JSON.stringify(data));
  
  if (data._embedded?.contacts?.length > 0) {
    return data._embedded.contacts[0].id;
  }

  return null;
}

async function createDeal(
  name: string,
  price: number,
  contactId?: number,
  customFields?: Record<string, string>
): Promise<number | null> {
  const deal: AmoCRMDeal = {
    name,
    price,
  };

  if (contactId) {
    deal._embedded = {
      contacts: [{ id: contactId }]
    };
  }

  const response = await makeAmoCRMRequest('/leads', 'POST', [deal]);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to create deal:', errorText);
    throw new Error(`Failed to create deal: ${errorText}`);
  }

  const data = await response.json();
  console.log('Deal created:', JSON.stringify(data));

  if (data._embedded?.leads?.length > 0) {
    return data._embedded.leads[0].id;
  }

  return null;
}

async function getCustomFields(): Promise<object> {
  const contactFieldsResponse = await makeAmoCRMRequest('/contacts/custom_fields');
  const leadFieldsResponse = await makeAmoCRMRequest('/leads/custom_fields');

  const contactFields = contactFieldsResponse.ok ? await contactFieldsResponse.json() : { _embedded: { custom_fields: [] } };
  const leadFields = leadFieldsResponse.ok ? await leadFieldsResponse.json() : { _embedded: { custom_fields: [] } };

  return {
    contacts: contactFields._embedded?.custom_fields || [],
    leads: leadFields._embedded?.custom_fields || [],
  };
}

async function getPipelines(): Promise<object> {
  const response = await makeAmoCRMRequest('/leads/pipelines');

  if (!response.ok) {
    console.error('Failed to get pipelines:', await response.text());
    return { pipelines: [] };
  }

  const data = await response.json();
  return {
    pipelines: data._embedded?.pipelines || [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify auth for admin endpoints
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    let action = url.searchParams.get('action') || undefined;

    let jsonBody: any | null = null;

    // Backwards compatibility: allow passing { action: "..." } in JSON body
    // (supabase.functions.invoke can't reliably add query params)
    if (!action && req.method !== 'GET') {
      try {
        jsonBody = await req.json();
        if (typeof jsonBody?.action === 'string') {
          action = jsonBody.action;
        }
      } catch {
        // ignore
      }
    }

    const getPayload = async (): Promise<Record<string, any>> => {
      if (jsonBody === null) {
        jsonBody = await req.json();
      }

      if (jsonBody && typeof jsonBody === 'object' && 'action' in jsonBody) {
        const { action: _ignored, ...rest } = jsonBody as Record<string, any>;
        return rest;
      }

      return (jsonBody ?? {}) as Record<string, any>;
    };

    switch (action) {
      case 'get-fields': {
        const fields = await getCustomFields();
        return new Response(
          JSON.stringify(fields),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-pipelines': {
        const pipelines = await getPipelines();
        return new Response(
          JSON.stringify(pipelines),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create-contact': {
        const payload = await getPayload();
        const { name, email, phone } = payload;

        if (!email) {
          return new Response(
            JSON.stringify({ error: 'Email is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const contactId = await createContact(name, email, phone);
        return new Response(
          JSON.stringify({ success: true, contactId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create-deal': {
        const payload = await getPayload();
        const { name, price, contactId, customFields } = payload;

        if (!name) {
          return new Response(
            JSON.stringify({ error: 'Deal name is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const dealId = await createDeal(name, price || 0, contactId, customFields);
        return new Response(
          JSON.stringify({ success: true, dealId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'test-connection': {
        const accountResponse = await makeAmoCRMRequest('/account');
        if (!accountResponse.ok) {
          const errorText = await accountResponse.text();
          return new Response(
            JSON.stringify({ success: false, error: errorText }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const accountData = await accountResponse.json();
        return new Response(
          JSON.stringify({ 
            success: true, 
            account: {
              id: accountData.id,
              name: accountData.name,
              subdomain: accountData.subdomain
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('AmoCRM sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
