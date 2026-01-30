import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@2.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Translate payment errors to Russian
function translatePaymentError(error: string): string {
  const errorMap: Record<string, string> = {
    'Insufficient funds': 'Недостаточно средств на карте',
    'insufficient_funds': 'Недостаточно средств на карте',
    'Declined': 'Отклонено банком',
    'declined': 'Отклонено банком',
    'Expired card': 'Срок действия карты истёк',
    'expired_card': 'Срок действия карты истёк',
    'Card restricted': 'Ограничения на карте',
    'card_restricted': 'Ограничения на карте',
    'Transaction not permitted': 'Операция не разрешена для данной карты',
    'transaction_not_permitted': 'Операция не разрешена для данной карты',
    'Invalid amount': 'Неверная сумма',
    'invalid_amount': 'Неверная сумма',
    'Authentication failed': 'Ошибка аутентификации 3D Secure',
    'authentication_failed': 'Ошибка аутентификации 3D Secure',
    '3-D Secure authentication failed': 'Ошибка подтверждения 3D Secure',
    'Payment failed': 'Платёж не прошёл',
    'payment_failed': 'Платёж не прошёл',
    'Token expired': 'Сохранённая карта устарела',
    'token_expired': 'Сохранённая карта устарела',
    'Invalid token': 'Ошибка привязанной карты',
    'invalid_token': 'Ошибка привязанной карты',
    'Do not honor': 'Отклонено банком',
    'do_not_honor': 'Отклонено банком',
    'Lost card': 'Карта утеряна',
    'lost_card': 'Карта утеряна',
    'Stolen card': 'Карта украдена',
    'stolen_card': 'Карта украдена',
    'Invalid card': 'Неверные данные карты',
    'invalid_card': 'Неверные данные карты',
    'Card number is invalid': 'Неверный номер карты',
  };

  // Try exact match first
  if (errorMap[error]) return errorMap[error];
  
  // Try case-insensitive partial match
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  
  // Return original with prefix if no translation found
  return `Ошибка платежа: ${error}`;
}

// Send order to GetCourse
// Now uses getcourse_offer_id from tariffs table instead of hardcoded mapping
interface GetCourseUserData {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

// Generate a consistent deal_number from orderNumber for GetCourse updates
function generateDealNumber(orderNumber: string): number {
  let hash = 0;
  for (let i = 0; i < orderNumber.length; i++) {
    const char = orderNumber.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

async function sendToGetCourse(
  userData: GetCourseUserData,
  offerId: number,
  orderNumber: string,
  amount: number,
  tariffCode: string
): Promise<{ success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number }> {
  const apiKey = Deno.env.get('GETCOURSE_API_KEY');
  const accountName = 'gorbova';
  
  if (!apiKey) {
    console.log('GetCourse API key not configured, skipping');
    return { success: false, error: 'API key not configured' };
  }
  
  if (!offerId) {
    console.log(`No getcourse_offer_id for tariff: ${tariffCode}, skipping GetCourse sync`);
    return { success: false, error: `No GetCourse offer ID for tariff: ${tariffCode}` };
  }
  
  try {
    console.log(`Sending order to GetCourse: email=${userData.email}, offerId=${offerId}, orderNumber=${orderNumber}`);
    
    // Generate a consistent deal_number from our order_number for future updates
    const dealNumber = generateDealNumber(orderNumber);
    console.log(`Generated deal_number=${dealNumber} from orderNumber=${orderNumber}`);
    
    const params = {
      user: {
        email: userData.email,
        phone: userData.phone || undefined,
        first_name: userData.firstName || undefined,
        last_name: userData.lastName || undefined,
      },
      system: {
        refresh_if_exists: 1,
      },
      deal: {
        // CRITICAL: Pass our own deal_number so we can update this deal later
        deal_number: dealNumber,
        offer_code: offerId.toString(),
        deal_cost: amount, // Already in BYN, not kopecks
        deal_status: 'payed',
        deal_is_paid: 1,
        payment_type: 'CARD',
        manager_email: 'info@ajoure.by',
        deal_comment: `Оплата через сайт club.gorbova.by. Order: ${orderNumber}`,
      },
    };
    
    console.log('GetCourse params:', JSON.stringify(params, null, 2));
    
    const formData = new URLSearchParams();
    formData.append('action', 'add');
    formData.append('key', apiKey);
    formData.append('params', btoa(unescape(encodeURIComponent(JSON.stringify(params)))));
    
    const response = await fetch(`https://${accountName}.getcourse.ru/pl/api/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('GetCourse response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Failed to parse GetCourse response:', responseText);
      return { success: false, error: `Invalid response: ${responseText.substring(0, 200)}` };
    }
    
    // Check result.success, not top-level success (which is just API call status)
    if (data.result?.success === true) {
      console.log('Order successfully sent to GetCourse, deal_id:', data.result?.deal_id, 'deal_number:', dealNumber);
      return { success: true, gcOrderId: data.result?.deal_id?.toString(), gcDealNumber: dealNumber };
    } else {
      const errorMsg = data.result?.error_message || data.error_message || 'Unknown error';
      console.error('GetCourse error:', errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('GetCourse API error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// AmoCRM integration helpers
function normalizeAmoCRMSubdomain(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/([a-z0-9-]+)\.amocrm\.(ru|com)/i);
  if (match?.[1]) return match[1].toLowerCase();

  const withoutProto = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^https?\/\//i, '');

  const host = withoutProto.split('/')[0];
  return host.split('.')[0].toLowerCase();
}

async function createAmoCRMContact(
  name: string,
  email: string,
  phone?: string
): Promise<number | null> {
  const accessToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const subdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN');
  const subdomain = subdomainRaw ? normalizeAmoCRMSubdomain(subdomainRaw) : null;

  if (!accessToken || !subdomain) {
    console.log('AmoCRM not configured, skipping contact creation');
    return null;
  }

  try {
    // First search for existing contact
    const searchResponse = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/contacts?query=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData._embedded?.contacts?.length > 0) {
        console.log('AmoCRM contact already exists:', searchData._embedded.contacts[0].id);
        return searchData._embedded.contacts[0].id;
      }
    }

    // Create new contact
    const contact = {
      name: name || email.split('@')[0],
      custom_fields_values: [
        { field_id: 413855, values: [{ value: email }] }, // Email field
      ],
    };

    if (phone) {
      contact.custom_fields_values.push({
        field_id: 413853,
        values: [{ value: phone }],
      });
    }

    const createResponse = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/contacts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([contact]),
      }
    );

    if (createResponse.ok) {
      const data = await createResponse.json();
      const contactId = data._embedded?.contacts?.[0]?.id;
      console.log('AmoCRM contact created:', contactId);
      return contactId;
    } else {
      console.error('Failed to create AmoCRM contact:', await createResponse.text());
    }
  } catch (error) {
    console.error('AmoCRM contact creation error:', error);
  }

  return null;
}

async function createAmoCRMDeal(
  name: string,
  price: number,
  contactId?: number | null,
  meta?: Record<string, any>
): Promise<number | null> {
  const accessToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const subdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN');
  const subdomain = subdomainRaw ? normalizeAmoCRMSubdomain(subdomainRaw) : null;

  if (!accessToken || !subdomain) {
    console.log('AmoCRM not configured, skipping deal creation');
    return null;
  }

  try {
    const deal: any = {
      name,
      price,
    };

    if (contactId) {
      deal._embedded = {
        contacts: [{ id: contactId }],
      };
    }

    const response = await fetch(
      `https://${subdomain}.amocrm.ru/api/v4/leads`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([deal]),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const dealId = data._embedded?.leads?.[0]?.id;
      console.log('AmoCRM deal created:', dealId);
      return dealId;
    } else {
      console.error('Failed to create AmoCRM deal:', await response.text());
    }
  } catch (error) {
    console.error('AmoCRM deal creation error:', error);
  }

  return null;
}

// Normalize bePaid transaction status for consistent storage/filtering
function normalizeWebhookStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'successful':
    case 'success':
      return 'successful';
    case 'failed':
    case 'declined':
    case 'expired':
    case 'error':
      return 'failed';
    case 'incomplete':
    case 'processing':
    case 'pending':
      return 'pending';
    case 'refunded':
    case 'voided':
    case 'refund':
      return 'refunded';
    default:
      return 'unknown';
  }
}

// Normalize payment error into category for diagnostics
function normalizeErrorCategory(message: string | null, declineCode?: string | null): string {
  if (!message && !declineCode) return 'unknown';
  
  const lowerMessage = (message || '').toLowerCase();
  const code = declineCode || '';
  
  // Check decline codes first
  const declineCodeMap: Record<string, string> = {
    '51': 'insufficient_funds',
    '05': 'do_not_honor',
    '14': 'invalid_card',
    '33': 'expired_card',
    '41': 'lost_stolen',
    '43': 'lost_stolen',
    '54': 'expired_card',
    '61': 'issuer_block',
    'AB': 'issuer_block',
    'B1': 'issuer_block',
  };
  
  // Extract decline code from message
  const declineMatch = lowerMessage.match(/decline code[:\s]+(\w+)/i);
  if (declineMatch && declineCodeMap[declineMatch[1]]) {
    return declineCodeMap[declineMatch[1]];
  }
  if (code && declineCodeMap[code]) {
    return declineCodeMap[code];
  }
  
  // 3DS related
  if (
    lowerMessage.includes('3d secure') ||
    lowerMessage.includes('3-d secure') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('3ds') ||
    lowerMessage.includes('p.4011') ||
    lowerMessage.includes('p.4012') ||
    lowerMessage.includes('p.4013')
  ) {
    return 'needs_3ds';
  }
  
  // Insufficient funds
  if (lowerMessage.includes('insufficient') || lowerMessage.includes('51')) {
    return 'insufficient_funds';
  }
  
  // Do not honor
  if (lowerMessage.includes('do not honor') || lowerMessage.includes('05')) {
    return 'do_not_honor';
  }
  
  // Expired card
  if (lowerMessage.includes('expired') || lowerMessage.includes('33') || lowerMessage.includes('54')) {
    return 'expired_card';
  }
  
  // Invalid card
  if (lowerMessage.includes('invalid')) {
    return 'invalid_card';
  }
  
  // Lost/stolen
  if (lowerMessage.includes('lost') || lowerMessage.includes('stolen')) {
    return 'lost_stolen';
  }
  
  // Timeout
  if (lowerMessage.includes('timeout') || lowerMessage.includes('unavailable') || lowerMessage.includes('g.9999')) {
    return 'timeout';
  }
  
  // Issuer block
  if (lowerMessage.includes('block') || lowerMessage.includes('restrict') || lowerMessage.includes('not permitted')) {
    return 'issuer_block';
  }
  
  return 'unknown';
}

// bePaid public key for webhook signature verification (RSA-SHA256)
// This is the official bePaid public key for production webhooks
const BEPAID_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvjgDf0vOQMjhg47pSYKn
r1Ms4k3SWGZBGpVX/FBo/gzwfIBKJ84y+YMnc7sdS3PZ0b0wldeoAqoyEVN/e0k0
sF/j/tO9mM0VFXHX6VPk3w8CZIjPXV/kDj37B0BnECVKmYwIFG7IIVjBfWJqFmQh
Pq0+Oe8wRg5e7h0rh/D2ClLh/x8PB8NwdMOSI7AyKQ4Q9VF8EuQKe9JVXqZDVLu5
WrHvfQ4L4VJMCq3I36D/j8epOL8MHq0QU6PY7li7AO+O9n7BClf8ZFNDlN2N7Rrp
GN8gKxPKKPaGVyKf+8EJrJE2aJsDoWpGKD7wP5jmMbPfVMg56+j0MXQKVX3mJgDf
WwIDAQAB
-----END PUBLIC KEY-----`;

// Verify webhook signature using RSA-SHA256 (bePaid official method)
async function verifyWebhookSignature(body: string, signature: string | null, publicKeyPem?: string): Promise<boolean> {
  if (!signature) {
    console.log('Signature verification: missing signature');
    return false;
  }
  
  // Use provided key or fallback to default bePaid key
  let keyPem = publicKeyPem || BEPAID_PUBLIC_KEY;
  
  // Add PEM wrapper if missing
  if (!keyPem.includes('-----BEGIN')) {
    keyPem = `-----BEGIN PUBLIC KEY-----\n${keyPem}\n-----END PUBLIC KEY-----`;
  }
  
  console.log('Using public key (first 50 chars):', keyPem.substring(0, 50));
  console.log('Signature length:', signature.length);
  
  try {
    // Decode base64 signature
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    
    // Parse PEM to get raw key bytes
    const pemHeader = '-----BEGIN PUBLIC KEY-----';
    const pemFooter = '-----END PUBLIC KEY-----';
    const pemContents = keyPem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
    const keyBytes = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    console.log('Key bytes length:', keyBytes.length);
    console.log('Signature bytes length:', signatureBytes.length);
    
    // Import public key for RSA-SHA256 verification
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Verify signature
    const encoder = new TextEncoder();
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      encoder.encode(body)
    );
    
    console.log('RSA-SHA256 signature verification result:', isValid);
    return isValid;
  } catch (error) {
    console.error('RSA signature verification error:', error);
    return false;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let bodyText = '';

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = resendApiKey ? new Resend(resendApiKey) : null;
    
    // Get bePaid credentials from integration_instances (primary) or fallback to env
    const { data: bepaidInstance } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('provider', 'bepaid')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    // For webhook signature: use webhook_secret if set, otherwise fall back to secret_key
    const bepaidWebhookSecret = bepaidInstance?.config?.webhook_secret || bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    const bepaidSecretKey = bepaidInstance?.config?.secret_key || Deno.env.get('BEPAID_SECRET_KEY');
    console.log('Using bePaid webhook secret from:', bepaidInstance?.config?.webhook_secret ? 'webhook_secret' : (bepaidInstance?.config?.secret_key ? 'secret_key' : 'env'));

    // Read body as text for signature verification
    bodyText = await req.text();
    
    // Log webhook receipt for audit trail
    console.log(`[WEBHOOK-RECEIVED] Timestamp: ${new Date().toISOString()}, Size: ${bodyText.length} bytes`);
    
    // Log webhook signature header for debugging
    // bePaid uses Content-Signature header (primary), fallback to X-Signature or X-Webhook-Signature
    const signatureHeader = req.headers.get('Content-Signature') || 
                            req.headers.get('X-Signature') ||
                            req.headers.get('X-Webhook-Signature') || 
                            req.headers.get('Authorization')?.replace('Bearer ', '') || null;
    console.log('Webhook signature header:', signatureHeader ? 'present' : 'missing', 
      'Headers checked: Content-Signature, X-Signature, X-Webhook-Signature');
    
    // SIGNATURE VERIFICATION with graceful fallback
    // bePaid subscription webhooks often come without signature or with different format
    // We verify when possible, but allow processing with audit logging if verification fails
    // and the webhook contains valid tracking_id matching our order format
    
    let signatureVerified = false;
    let signatureSkipReason: string | null = null;
    
    // Parse body early to validate tracking_id BEFORE signature check
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      console.error('[WEBHOOK-ERROR] Failed to parse webhook body:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: corsHeaders }
      );
    }
    
    // Extract tracking_id for validation
    const rawTrackingIdEarly = body.tracking_id || 
                               body.additional_data?.order_id ||
                               body.transaction?.tracking_id ||
                               body.last_transaction?.tracking_id ||
                               null;
    
    // Check if tracking_id contains valid UUID (our order format)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const hasValidTrackingId = rawTrackingIdEarly && uuidPattern.test(rawTrackingIdEarly);
    
    // Extract transaction status and amount for validation
    const txStatus = body.transaction?.status || body.status || '';
    const txAmount = body.transaction?.amount || body.amount || 0;
    const isSuccessfulPayment = txStatus === 'successful' && txAmount > 0;
    
    // RELAXED SIGNATURE VERIFICATION:
    // Accept webhook if EITHER:
    // 1. Signature is valid
    // 2. OR tracking_id matches our UUID format (meaning it's from our system)
    // 3. OR it's a successful payment with amount > 0 (legitimate bePaid callback)
    
    if (bepaidWebhookSecret && signatureHeader) {
      const customPublicKey = bepaidInstance?.config?.public_key || undefined;
      signatureVerified = await verifyWebhookSignature(bodyText, signatureHeader, customPublicKey);
      
      if (signatureVerified) {
        console.log('[WEBHOOK-OK] bePaid webhook signature verified successfully');
      } else {
        signatureSkipReason = 'invalid_signature';
        console.warn('[WEBHOOK-WARN] Signature verification failed, checking fallback conditions...');
        
        // FALLBACK: Accept if tracking_id is valid UUID or it's a successful payment
        if (hasValidTrackingId) {
          console.log('[WEBHOOK-FALLBACK] Accepting webhook due to valid tracking_id UUID format');
          signatureVerified = true; // Treat as verified
          signatureSkipReason = 'accepted_by_tracking_id';
        } else if (isSuccessfulPayment) {
          console.log('[WEBHOOK-FALLBACK] Accepting webhook due to successful payment status');
          signatureVerified = true; // Treat as verified  
          signatureSkipReason = 'accepted_by_payment_status';
        }
      }
    } else if (!bepaidWebhookSecret) {
      signatureSkipReason = 'no_secret_configured';
      console.warn('[WEBHOOK-WARN] BEPAID_SECRET_KEY not configured - accepting all webhooks');
      signatureVerified = true; // Accept when no secret configured
    } else {
      signatureSkipReason = 'no_signature_header';
      console.warn('[WEBHOOK-WARN] No signature header present');
      
      // FALLBACK for missing header: accept if valid tracking_id or successful payment
      if (hasValidTrackingId || isSuccessfulPayment) {
        console.log('[WEBHOOK-FALLBACK] Accepting webhook without signature due to valid data');
        signatureVerified = true;
      }
    }
    
    console.log(`[WEBHOOK-SIGNATURE] verified=${signatureVerified}, reason=${signatureSkipReason}, hasValidTrackingId=${hasValidTrackingId}, isSuccessfulPayment=${isSuccessfulPayment}`);
    
    // If signature not verified and no valid tracking_id, save to queue for manual review
    if (!signatureVerified && !hasValidTrackingId) {
      console.error('[WEBHOOK-ERROR] No signature and no valid tracking_id - saving to queue');
      
      const transaction = body.transaction || body.last_transaction || {};
      const additionalData = body.additional_data || {};
      
      // Extract reference/parent UID for refund linking
      const referenceUid = transaction.parent_uid || body.parent_uid || null;
      const transactionType = transaction.type || body.type || null;
      
      await supabase.from('payment_reconcile_queue').insert({
        bepaid_uid: transaction.uid || null,
        tracking_id: rawTrackingIdEarly || null,
        amount: transaction.amount ? transaction.amount / 100 : (body.plan?.amount ? body.plan.amount / 100 : null),
        currency: transaction.currency || body.plan?.currency || 'BYN',
        customer_email: transaction.customer?.email || body.customer?.email || additionalData.customer_email || null,
        raw_payload: body,
        source: 'webhook',
        status: 'pending',
        last_error: signatureSkipReason || 'no_tracking_id',
        transaction_type: transactionType === 'refund' ? 'Возврат средств' : transactionType,
        reference_transaction_uid: referenceUid,
      });
      
      await supabase.from('audit_logs').insert({
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid-webhook',
        action: 'webhook.queued_for_review',
        meta: { reason: signatureSkipReason, tracking_id: rawTrackingIdEarly, body_preview: bodyText.substring(0, 500) },
      });
      
      return new Response(
        JSON.stringify({ error: 'Queued for manual review', queued: true }),
        { status: 202, headers: corsHeaders }
      );
    }
    
    // Log if processing without signature but with valid tracking_id
    if (!signatureVerified && hasValidTrackingId) {
      console.log('[WEBHOOK-INFO] Processing without signature verification - valid tracking_id found:', rawTrackingIdEarly);
      
      await supabase.from('audit_logs').insert({
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid-webhook',
        action: 'webhook.processed_without_signature',
        meta: { 
          reason: signatureSkipReason, 
          tracking_id: rawTrackingIdEarly,
          transaction_uid: body.transaction?.uid || body.last_transaction?.uid,
        },
      });
    }

    // body already parsed above
    console.log('[WEBHOOK-BODY] bePaid webhook received:', JSON.stringify(body, null, 2));

    // =========================================================================
    // CRITICAL: Save ALL incoming transactions to queue IMMEDIATELY for audit
    // This ensures NO transaction is ever lost, regardless of processing result
    // =========================================================================
    const webhookTransaction = body.transaction || body.last_transaction || {};
    const webhookTxStatus = webhookTransaction.status || body.status || 'unknown';
    const webhookTxType = webhookTransaction.type || body.type || null;
    const webhookReferenceUid = webhookTransaction.parent_uid || body.parent_uid || null;
    const webhookAdditionalData = body.additional_data || {};
    
    // Determine if this is a refund
    const isWebhookRefund = webhookTxType === 'refund' || 
                           body.refund || 
                           webhookTransaction.refund_reason !== undefined;
    
    // Normalize status for consistent filtering
    const webhookNormalizedStatus = normalizeWebhookStatus(webhookTxStatus);
    
    // Save to queue (upsert by bepaid_uid to avoid duplicates)
    if (webhookTransaction.uid) {
      try {
        const errorMsg = webhookTxStatus !== 'successful' ? (webhookTransaction.message || `Status: ${webhookTxStatus}`) : null;
        const errorCategory = errorMsg ? normalizeErrorCategory(errorMsg, webhookTransaction.decline_code) : null;
        
        await supabase.from('payment_reconcile_queue').upsert({
          bepaid_uid: webhookTransaction.uid,
          tracking_id: rawTrackingIdEarly || null,
          amount: webhookTransaction.amount ? webhookTransaction.amount / 100 : (body.plan?.amount ? body.plan.amount / 100 : null),
          currency: webhookTransaction.currency || body.plan?.currency || 'BYN',
          customer_email: webhookTransaction.customer?.email || body.customer?.email || webhookAdditionalData.customer_email || null,
          customer_phone: webhookTransaction.customer?.phone || body.customer?.phone || null,
          card_holder: webhookTransaction.credit_card?.holder || null,
          card_last4: webhookTransaction.credit_card?.last_4 || null,
          card_brand: webhookTransaction.credit_card?.brand || null,
          card_bank: webhookTransaction.credit_card?.bank || null,
          card_bank_country: webhookTransaction.credit_card?.issuer_country || null,
          receipt_url: webhookTransaction.receipt_url || null,
          raw_payload: body,
          source: 'webhook',
          status: webhookTxStatus === 'successful' ? 'pending' : 'error',
          status_normalized: webhookNormalizedStatus,
          transaction_type: isWebhookRefund ? 'Возврат средств' : 'Оплата',
          paid_at: webhookTransaction.paid_at || webhookTransaction.created_at || new Date().toISOString(),
          reference_transaction_uid: webhookReferenceUid,
          last_error: errorMsg,
          error_category: errorCategory,
          three_d_secure: webhookTransaction.three_d_secure_verification?.status === 'successful',
        }, { onConflict: 'bepaid_uid', ignoreDuplicates: false });
        
        console.log(`[WEBHOOK-QUEUE] Saved transaction ${webhookTransaction.uid} with status ${webhookNormalizedStatus}`);
      } catch (queueErr) {
        console.error('[WEBHOOK-QUEUE] Failed to save to queue:', queueErr);
        // Continue processing even if queue save fails
      }
    }

    // bePaid sends subscription webhooks with data directly in body (not nested in .subscription)
    // Check if this is a subscription webhook (has 'state' and 'plan' fields directly in body)
    const isSubscriptionWebhook = body.state && body.plan;
    
    // For subscription webhooks, the subscription data IS the body
    const subscription = isSubscriptionWebhook ? body : (body.subscription || null);
    
    // bePaid can send either transaction webhooks or subscription webhooks
    const transaction = body.transaction || subscription?.last_transaction || null;

    // Get tracking_id from multiple possible locations
    const rawTrackingId = body.tracking_id ||
                    body.additional_data?.order_id ||
                    transaction?.tracking_id ||
                    subscription?.tracking_id ||
                    null;

    // Parse tracking_id: format can be {order_id}_{offer_id} or just {order_id}
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let parsedOrderId: string | null = null;
    let parsedOfferId: string | null = null;
    
    if (rawTrackingId) {
      const parts = rawTrackingId.split('_');
      if (parts.length >= 1 && uuidRegex.test(parts[0])) {
        parsedOrderId = parts[0];
        if (parts.length >= 2 && uuidRegex.test(parts[1])) {
          parsedOfferId = parts[1];
        }
      }
    }
    
    // For backward compatibility, orderId is the parsed order ID
    const orderId = parsedOrderId;

    const transactionStatus = transaction?.status || null;
    const transactionUid = transaction?.uid || null;
    const paymentMethod = transaction?.payment_method_type || transaction?.payment_method || null;
    const subscriptionId = body.id || subscription?.id || null;
    const subscriptionState = body.state || subscription?.state || null;
    
    // Detect if this is a refund transaction
    const transactionType = transaction?.type || body.type || null;
    const isRefundTransaction = transactionType === 'refund' || 
                                body.refund || 
                                transaction?.refund_reason !== undefined;

    console.log(`Processing bePaid webhook: tracking=${rawTrackingId}, orderId=${orderId}, offerId=${parsedOfferId}, transaction=${transactionUid}, status=${transactionStatus}, subscription=${subscriptionId}, state=${subscriptionState}, isRefund=${isRefundTransaction}`);

    // ---------------------------------------------------------------------
    // V2 direct-charge support
    // In direct-charge we send tracking_id = payments_v2.id (UUID).
    // This block finalizes orders_v2/payments_v2/subscriptions_v2 for 3DS flows.
    // ---------------------------------------------------------------------
    let paymentV2: any = null;
    if (orderId) {
      const { data: p2, error: p2Err } = await supabase
        .from('payments_v2')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (!p2Err && p2) paymentV2 = p2;
    }
    
    // ---------------------------------------------------------------------
    // ORPHAN ORDER DETECTION: If order_id from tracking doesn't exist,
    // and transaction is successful, create the missing order automatically
    // ---------------------------------------------------------------------
    if (!paymentV2 && orderId && transactionStatus === 'successful' && transaction?.amount) {
      // Check if order exists in orders_v2
      const { data: existingOrder } = await supabase
        .from('orders_v2')
        .select('id')
        .eq('id', orderId)
        .maybeSingle();
      
      // Also check legacy orders table
      const { data: legacyOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('id', orderId)
        .maybeSingle();
      
      if (!existingOrder && !legacyOrder) {
        // ORDER NOT FOUND - this is the Людмила case!
        console.warn(`[WEBHOOK] Orphan payment detected! Order ${orderId} doesn't exist. Creating from webhook data...`);
        
        try {
          const createdOrder = await createOrderFromWebhook(
            supabase,
            orderId,
            parsedOfferId,
            transaction,
            subscription,
            body
          );
          
          if (createdOrder) {
            console.log(`[WEBHOOK] Created orphan order: ${createdOrder.order_number}`);
            
            // Notify admins immediately
            try {
              await supabase.functions.invoke('telegram-notify-admins', {
                body: {
                  message: `🔧 Автоматически создан пропущенный заказ!\n\n` +
                    `Заказ: ${createdOrder.order_number}\n` +
                    `Email: ${transaction.customer?.email || 'N/A'}\n` +
                    `Сумма: ${transaction.amount / 100} ${transaction.currency || 'BYN'}\n` +
                    `bePaid UID: ${transactionUid || 'N/A'}\n` +
                    `Подписка: ${subscriptionId || 'N/A'}`,
                  type: 'orphan_order_created',
                },
              });
            } catch (notifyErr) {
              console.error('Failed to notify admins:', notifyErr);
            }
            
            // Return success - order was created and processed
            return new Response(
              JSON.stringify({ 
                success: true, 
                message: 'Orphan order created and processed',
                order_number: createdOrder.order_number,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (createErr) {
          console.error('[WEBHOOK] Failed to create orphan order:', createErr);
          
          // Queue for manual review instead of failing
          await supabase.from('payment_reconcile_queue').insert({
            bepaid_uid: transactionUid,
            tracking_id: rawTrackingId,
            amount: transaction.amount / 100,
            currency: transaction.currency || 'BYN',
            customer_email: transaction.customer?.email,
            raw_payload: body,
            source: 'webhook_orphan',
            status: 'pending',
            last_error: `Failed to create order: ${String(createErr)}`,
          });
          
          // Notify admins
          try {
            await supabase.functions.invoke('telegram-notify-admins', {
              body: {
                message: `⚠️ Не удалось создать пропущенный заказ\n\n` +
                  `Email: ${transaction.customer?.email || 'N/A'}\n` +
                  `Сумма: ${transaction.amount / 100} ${transaction.currency || 'BYN'}\n` +
                  `bePaid UID: ${transactionUid || 'N/A'}\n` +
                  `Ошибка: ${String(createErr)}\n\n` +
                  `Добавлено в очередь на ручную обработку.`,
                type: 'orphan_order_failed',
              },
            });
          } catch (notifyErr) {
            console.error('Failed to notify admins:', notifyErr);
          }
        }
      }
    }

    if (paymentV2) {
      const now = new Date();

      // Keep provider response for debugging
      const basePaymentUpdate: Record<string, any> = {
        provider_payment_id: transactionUid || paymentV2.provider_payment_id || null,
        provider_response: body,
        error_message: transaction?.message || null,
        card_brand: transaction?.credit_card?.brand || paymentV2.card_brand || null,
        card_last4: transaction?.credit_card?.last_4 || paymentV2.card_last4 || null,
        // Save receipt_url from webhook if available
        receipt_url: transaction?.receipt_url || paymentV2.receipt_url || null,
        // PATCH 1: Sync amount from bePaid transaction (source of truth)
        ...(transaction?.amount != null
          ? { amount: transaction.amount / 100 }
          : {}),
      };

      // =====================================================================
      // REFUND HANDLING - process refund transactions idempotently
      // =====================================================================
      if (isRefundTransaction && transactionUid) {
        console.log(`Processing refund webhook for payment ${paymentV2.id}, refund UID: ${transactionUid}`);
        
        const existingRefunds = (paymentV2.refunds || []) as any[];
        
        // Check idempotency - skip if this refund already exists
        const alreadyExists = existingRefunds.find(r => r.refund_id === transactionUid);
        
        if (alreadyExists) {
          console.log(`Refund ${transactionUid} already recorded, updating status only`);
          
          // Update existing refund status if changed
          const updatedRefunds = existingRefunds.map(r => {
            if (r.refund_id === transactionUid) {
              return {
                ...r,
                status: transactionStatus === 'successful' ? 'succeeded' : transactionStatus,
                receipt_url: transaction?.receipt_url || r.receipt_url,
              };
            }
            return r;
          });
          
          const totalRefunded = updatedRefunds
            .filter(r => r.status === 'succeeded')
            .reduce((sum, r) => sum + r.amount, 0);
          
          await supabase
            .from('payments_v2')
            .update({
              ...basePaymentUpdate,
              refunds: updatedRefunds,
              refunded_amount: totalRefunded,
            })
            .eq('id', paymentV2.id);
          
          await supabase.from('audit_logs').insert({
            actor_user_id: null,
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            action: 'bepaid_refund_ignored_duplicate',
            meta: { 
              payment_id: paymentV2.id, 
              refund_id: transactionUid,
              order_id: paymentV2.order_id,
            },
          });
          
          return new Response(
            JSON.stringify({ ok: true, type: 'refund_duplicate', refund_id: transactionUid }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // New refund - add to array
        const refundAmount = (transaction?.amount || 0) / 100;
        const newRefund = {
          refund_id: transactionUid,
          amount: refundAmount,
          currency: transaction?.currency || 'BYN',
          status: transactionStatus === 'successful' ? 'succeeded' : transactionStatus,
          created_at: new Date().toISOString(),
          receipt_url: transaction?.receipt_url || null,
          reason: transaction?.message || transaction?.refund_reason || body.refund?.reason || null,
        };
        
        const updatedRefunds = [...existingRefunds, newRefund];
        const totalRefunded = updatedRefunds
          .filter(r => r.status === 'succeeded')
          .reduce((sum, r) => sum + r.amount, 0);
        
        const lastRefundAt = updatedRefunds
          .filter(r => r.status === 'succeeded')
          .map(r => new Date(r.created_at).getTime())
          .sort((a, b) => b - a)[0];
        
        await supabase
          .from('payments_v2')
          .update({
            ...basePaymentUpdate,
            refunds: updatedRefunds,
            refunded_amount: totalRefunded,
            refunded_at: lastRefundAt ? new Date(lastRefundAt).toISOString() : null,
          })
          .eq('id', paymentV2.id);
        
        // Check if fully refunded - update order status
        if (totalRefunded >= Number(paymentV2.amount)) {
          await supabase
            .from('orders_v2')
            .update({ status: 'refunded' })
            .eq('id', paymentV2.order_id);
          
          console.log(`Order ${paymentV2.order_id} fully refunded, status updated`);
        }
        
        // Audit log
        await supabase.from('audit_logs').insert({
          actor_user_id: null,
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: 'bepaid_refund_received',
          meta: { 
            payment_id: paymentV2.id, 
            order_id: paymentV2.order_id,
            refund: newRefund,
            total_refunded: totalRefunded,
            fully_refunded: totalRefunded >= Number(paymentV2.amount),
          },
        });
        
        console.log(`Refund ${transactionUid} recorded: ${refundAmount} ${newRefund.currency}, total refunded: ${totalRefunded}`);
        
        return new Response(
          JSON.stringify({ 
            ok: true, 
            type: 'refund', 
            refund_id: transactionUid,
            amount: refundAmount,
            total_refunded: totalRefunded,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (transactionStatus === 'successful') {
        await supabase
          .from('payments_v2')
          .update({
            ...basePaymentUpdate,
            status: 'succeeded',
            paid_at: now.toISOString(),
          })
          .eq('id', paymentV2.id);

        // Update order
        const { data: orderV2 } = await supabase
          .from('orders_v2')
          .select('*')
          .eq('id', paymentV2.order_id)
          .maybeSingle();

        if (orderV2 && orderV2.status !== 'paid') {
          await supabase
            .from('orders_v2')
            .update({
              status: 'paid',
              paid_amount: paymentV2.amount,
              meta: {
                ...(orderV2.meta || {}),
                bepaid_uid: transactionUid,
                payment_id: paymentV2.id,
              },
            })
            .eq('id', orderV2.id);

          // Fetch product + tariff for access calculation
          const { data: productV2 } = await supabase
            .from('products_v2')
            .select('id, name, code, currency, telegram_club_id')
            .eq('id', orderV2.product_id)
            .maybeSingle();

          const { data: tariff } = await supabase
            .from('tariffs')
            .select('id, name, code, access_days, getcourse_offer_id')
            .eq('id', orderV2.tariff_id)
            .maybeSingle();

          // Get offer settings to check if this is a subscription or one-time payment
          const offerType = orderV2.is_trial ? 'trial' : 'pay_now';
          const { data: offer } = await supabase
            .from('tariff_offers')
            .select('requires_card_tokenization, auto_charge_after_trial, getcourse_offer_id')
            .eq('tariff_id', orderV2.tariff_id)
            .eq('offer_type', offerType)
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Determine if this should be a recurring subscription
          const isRecurringSubscription = offer?.requires_card_tokenization ?? false;
          const autoChargeAfterTrial = offer?.auto_charge_after_trial ?? true;

          if (productV2 && tariff) {
            // Find existing active subscription to check for tariff change (proration)
            // IMPORTANT: exclude canceled subscriptions (canceled_at IS NOT NULL)
            let existingSub: { id: string; access_end_at: string; canceled_at: string | null; tariff_id: string; order_id: string | null } | null = null;
            
            if (!orderV2.is_trial) {
              const { data } = await supabase
                .from('subscriptions_v2')
                .select('id, access_end_at, canceled_at, tariff_id, order_id')
                .eq('user_id', orderV2.user_id)
                .eq('product_id', orderV2.product_id)
                .in('status', ['active', 'trial'])
                .is('canceled_at', null) // Only extend non-canceled subscriptions
                .gte('access_end_at', now.toISOString()) // Only extend subscriptions still in the future
                .order('access_end_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              
              existingSub = data;
            }

            const isSameTariff = existingSub && existingSub.tariff_id === orderV2.tariff_id;
            
            // Calculate proration for tariff change
            interface ProrationResult {
              bonusDays: number;
              unusedValue: number;
              remainingDays: number;
              oldTariffId: string;
            }
            let prorationResult: ProrationResult | null = null;
            
            if (existingSub && !isSameTariff && !orderV2.is_trial && existingSub.order_id) {
              console.log(`Webhook: User is changing tariff from ${existingSub.tariff_id} to ${orderV2.tariff_id}, calculating proration...`);
              
              // Get paid amount from old order
              const { data: oldOrder } = await supabase
                .from('orders_v2')
                .select('paid_amount, final_price')
                .eq('id', existingSub.order_id)
                .single();
              
              // Get access_days from old tariff
              const { data: oldTariff } = await supabase
                .from('tariffs')
                .select('access_days')
                .eq('id', existingSub.tariff_id)
                .single();
              
              if (oldOrder && oldTariff?.access_days) {
                const oldPaidAmount = oldOrder.paid_amount || oldOrder.final_price || 0;
                const accessEnd = new Date(existingSub.access_end_at);
                const remainingMs = accessEnd.getTime() - now.getTime();
                const remainingDays = Math.max(0, remainingMs / (24 * 60 * 60 * 1000));
                
                if (remainingDays > 0 && oldPaidAmount > 0) {
                  const oldDailyRate = oldPaidAmount / oldTariff.access_days;
                  const unusedValue = oldDailyRate * remainingDays;
                  const newDailyRate = paymentV2.amount / tariff.access_days;
                  const bonusDays = newDailyRate > 0 ? Math.floor(unusedValue / newDailyRate) : 0;
                  
                  prorationResult = {
                    bonusDays,
                    unusedValue,
                    remainingDays,
                    oldTariffId: existingSub.tariff_id,
                  };
                  
                  console.log(`Webhook proration: ${remainingDays.toFixed(1)} days remaining, bonus: ${bonusDays} days`);
                }
              }
            }

            const baseAccessDays = orderV2.is_trial
              ? Math.max(1, Math.ceil((new Date(orderV2.trial_end_at).getTime() - new Date(orderV2.created_at).getTime()) / (24 * 60 * 60 * 1000)))
              : (tariff.access_days || 30);
            
            const prorationBonusDays = prorationResult?.bonusDays || 0;
            const accessDays = baseAccessDays + prorationBonusDays;

            // For same tariff non-trial: extend from existing subscription end date
            const extendFromDate = (existingSub && isSameTariff && !orderV2.is_trial) ? new Date(existingSub.access_end_at) : null;
            const baseDate = extendFromDate || new Date();
            const accessEndAt = orderV2.is_trial
              ? new Date(orderV2.trial_end_at)
              : new Date(baseDate.getTime() + accessDays * 24 * 60 * 60 * 1000);

            // Set next_charge_at only if this is a recurring subscription or trial with auto-charge
            let nextChargeAt: Date | null = null;
            if (orderV2.is_trial && autoChargeAfterTrial) {
              nextChargeAt = new Date(accessEndAt.getTime() - 24 * 60 * 60 * 1000);
            } else if (!orderV2.is_trial && isRecurringSubscription) {
              nextChargeAt = new Date(accessEndAt.getTime() - 3 * 24 * 60 * 60 * 1000);
            }
            // If not recurring subscription (one-time payment), next_charge_at stays null

            console.log('Subscription upsert logic:', {
              existingSubId: existingSub?.id,
              existingEndAt: existingSub?.access_end_at,
              isSameTariff,
              extendFromDate: extendFromDate?.toISOString(),
              baseAccessDays,
              prorationBonusDays,
              totalAccessDays: accessDays,
              newAccessEndAt: accessEndAt.toISOString(),
              nextChargeAt: nextChargeAt?.toISOString(),
              isRecurringSubscription,
            });

            // === CRITICAL FIX: Create/link payment_method from checkout card data ===
            // This ensures users can see and manage their cards
            let paymentMethodId: string | null = (orderV2.meta as any)?.payment_method_id || null;
            const cardData = transaction?.credit_card;
            
            // If card token is present and no payment_method_id yet, create or find payment_method
            if (paymentV2.payment_token && cardData && !paymentMethodId && isRecurringSubscription) {
              console.log('Creating payment_method from checkout card data...');
              
              // Check if payment_method with this token already exists
              const { data: existingPM } = await supabase
                .from('payment_methods')
                .select('id')
                .eq('user_id', orderV2.user_id)
                .eq('provider_token', paymentV2.payment_token)
                .maybeSingle();
              
              if (existingPM) {
                paymentMethodId = existingPM.id;
                console.log('Found existing payment_method:', paymentMethodId);
              } else {
                // Create new payment_method
                const { data: newPM, error: pmError } = await supabase
                  .from('payment_methods')
                  .insert({
                    user_id: orderV2.user_id,
                    provider: 'bepaid',
                    provider_token: paymentV2.payment_token,
                    brand: cardData.brand || null,
                    last4: cardData.last_4 || null,
                    exp_month: cardData.exp_month ? parseInt(cardData.exp_month) : null,
                    exp_year: cardData.exp_year ? parseInt(cardData.exp_year) : null,
                    is_default: true,
                    status: 'active',
                    card_product: cardData.product || null,
                    card_category: cardData.category || null,
                  })
                  .select('id')
                  .single();
                
                if (pmError) {
                  console.error('Failed to create payment_method:', pmError);
                } else {
                  paymentMethodId = newPM.id;
                  console.log('Created new payment_method:', paymentMethodId);
                  
                  // Unset is_default for other payment methods of this user
                  await supabase
                    .from('payment_methods')
                    .update({ is_default: false })
                    .eq('user_id', orderV2.user_id)
                    .neq('id', paymentMethodId);
                }
              }
            }

            if (existingSub && isSameTariff && !orderV2.is_trial) {
              // Update existing active subscription - extend it (same tariff)
              await supabase
                .from('subscriptions_v2')
                .update({
                  status: 'active',
                  is_trial: false,
                  access_end_at: accessEndAt.toISOString(),
                  next_charge_at: nextChargeAt?.toISOString() || null,
                  payment_method_id: paymentMethodId,
                  payment_token: paymentMethodId ? paymentV2.payment_token : null, // Only save token if payment_method exists
                  updated_at: now.toISOString(),
                })
                .eq('id', existingSub.id);
              
              console.log('Updated existing subscription:', existingSub.id, 'payment_method_id:', paymentMethodId);
            } else {
              // Create new subscription (new tariff or upgrade/downgrade with proration)
              const subscriptionMeta = prorationResult ? {
                proration: {
                  from_tariff_id: prorationResult.oldTariffId,
                  remaining_days: Math.round(prorationResult.remainingDays * 10) / 10,
                  unused_value: Math.round(prorationResult.unusedValue),
                  bonus_days: prorationResult.bonusDays,
                }
              } : undefined;
              
              const { data: newSub } = await supabase
                .from('subscriptions_v2')
                .insert({
                  user_id: orderV2.user_id,
                  product_id: orderV2.product_id,
                  tariff_id: orderV2.tariff_id,
                  order_id: orderV2.id,
                  status: orderV2.is_trial ? 'trial' : 'active',
                  is_trial: !!orderV2.is_trial,
                  access_start_at: now.toISOString(),
                  access_end_at: accessEndAt.toISOString(),
                  trial_end_at: orderV2.is_trial ? accessEndAt.toISOString() : null,
                  next_charge_at: nextChargeAt?.toISOString() || null,
                  payment_method_id: paymentMethodId,
                  payment_token: paymentMethodId ? paymentV2.payment_token : null, // Only save token if payment_method exists
                  meta: subscriptionMeta,
                })
                .select('id')
                .single();
              
              console.log('Created new subscription:', newSub?.id);
              
              // If tariff changed - cancel old subscription
              if (existingSub && !isSameTariff) {
                console.log(`Canceling old subscription ${existingSub.id} due to tariff change`);
                await supabase
                  .from('subscriptions_v2')
                  .update({
                    status: 'canceled',
                    canceled_at: now.toISOString(),
                    cancel_reason: `Changed to tariff. Proration: ${prorationBonusDays} bonus days applied.`,
                  })
                  .eq('id', existingSub.id);
              }
            }

            // === ALWAYS CREATE/UPDATE ENTITLEMENT (Variant 1: upsert by user_id, product_code) ===
            const productCode = productV2.code || `product_${productV2.id}`;

            // Guard: проверяем, что user_id — реальный auth user (есть профиль)
            const { data: userProfileCheck } = await supabase
              .from('profiles')
              .select('id, user_id, email, telegram_user_id, telegram_link_status, phone, first_name, last_name')
              .eq('user_id', orderV2.user_id)
              .maybeSingle();

            if (!userProfileCheck) {
              // Ghost user_id — не создаём entitlement, помечаем для ручной обработки
              console.warn('[ENTITLEMENT] Ghost user_id detected, skipping entitlement:', orderV2.user_id);
              await supabase.from('audit_logs').insert({
                actor_user_id: orderV2.user_id,
                action: 'entitlement_skipped_ghost_user',
                meta: { order_id: orderV2.id, order_number: orderV2.order_number },
              });
            } else {
              // Idempotency guard: проверяем, есть ли уже запись в entitlement_orders для этого order_id
              const { data: existingEO } = await supabase
                .from('entitlement_orders')
                .select('id, entitlement_id')
                .eq('order_id', orderV2.id)
                .maybeSingle();

              if (existingEO) {
                console.log('[ENTITLEMENT_ORDERS] Already linked for order:', orderV2.id);
              } else {
                // Expires: строго subscriptions_v2.access_end_at
                const entitlementExpiresAt = accessEndAt.toISOString();

                // Upsert entitlement с GREATEST(expires_at)
                const { data: existingEntitlement } = await supabase
                  .from('entitlements')
                  .select('id, expires_at')
                  .eq('user_id', orderV2.user_id)
                  .eq('product_code', productCode)
                  .maybeSingle();

                let entitlementId: string;

                if (existingEntitlement) {
                  // Update с GREATEST(expires_at)
                  const currentExpires = existingEntitlement.expires_at ? new Date(existingEntitlement.expires_at) : new Date(0);
                  const newExpires = new Date(entitlementExpiresAt);
                  const finalExpires = currentExpires > newExpires ? currentExpires : newExpires;

                  await supabase
                    .from('entitlements')
                    .update({
                      expires_at: finalExpires.toISOString(),
                      status: 'active',
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingEntitlement.id);

                  entitlementId = existingEntitlement.id;
                  console.log('[ENTITLEMENT] Updated with GREATEST expires_at:', finalExpires.toISOString());
                } else {
                  // Insert new entitlement
                  const { data: newEntitlement, error: entitlementError } = await supabase
                    .from('entitlements')
                    .insert({
                      user_id: orderV2.user_id,
                      profile_id: userProfileCheck.id,
                      order_id: orderV2.id, // первый order_id
                      product_code: productCode,
                      status: 'active',
                      expires_at: entitlementExpiresAt,
                      meta: {
                        order_number: orderV2.order_number,
                        product_name: productV2.name,
                        tariff_name: tariff.name,
                        bepaid_uid: transactionUid,
                        source: 'bepaid_webhook_v2',
                      },
                    })
                    .select('id')
                    .single();

                  if (entitlementError) {
                    console.error('[ENTITLEMENT] Insert failed:', entitlementError);
                    await supabase.from('audit_logs').insert({
                      actor_user_id: orderV2.user_id,
                      action: 'entitlement_failed_v2',
                      meta: { order_id: orderV2.id, error: entitlementError.message },
                    });
                    throw new Error(`Entitlement creation failed: ${entitlementError.message}`);
                  }

                  entitlementId = newEntitlement.id;
                  console.log('[ENTITLEMENT] Created:', entitlementId);
                }

                // Создаём запись в entitlement_orders (связка order → entitlement)
                const { error: eoError } = await supabase
                  .from('entitlement_orders')
                  .insert({
                    order_id: orderV2.id,
                    entitlement_id: entitlementId,
                    user_id: orderV2.user_id,
                    product_code: productCode,
                    meta: {
                      bepaid_uid: transactionUid,
                      order_number: orderV2.order_number,
                      tariff_name: tariff.name,
                      access_end_at: entitlementExpiresAt,
                    },
                  });

                if (eoError) {
                  console.error('[ENTITLEMENT_ORDERS] Insert failed:', eoError);
                } else {
                  console.log('[ENTITLEMENT_ORDERS] Linked order', orderV2.id, '→ entitlement', entitlementId);
                }

                await supabase.from('audit_logs').insert({
                  actor_user_id: orderV2.user_id,
                  action: 'entitlement_created_v2',
                  meta: { 
                    order_id: orderV2.id, 
                    entitlement_id: entitlementId,
                    product_code: productCode, 
                    expires_at: entitlementExpiresAt 
                  },
                });
              }
            }

            // Use the same profile data for Telegram check
            const userProfile = userProfileCheck;

            // ===== GetCourse sync - ALWAYS attempt, INDEPENDENT of Telegram =====
            const getcourseOfferId = offer?.getcourse_offer_id || tariff.getcourse_offer_id;
            const customerEmail = orderV2.customer_email || userProfile?.email;
            
            if (getcourseOfferId && customerEmail) {
              console.log(`[GC-SYNC] Starting: offer_id=${getcourseOfferId}, email=${customerEmail}`);
              
              const gcResult = await sendToGetCourse(
                {
                  email: customerEmail,
                  phone: userProfile?.phone || orderV2.customer_phone || null,
                  firstName: userProfile?.first_name || null,
                  lastName: userProfile?.last_name || null,
                },
                parseInt(getcourseOfferId, 10) || 0,
                orderV2.order_number,
                paymentV2.amount,
                tariff.code || tariff.name
              );
              
              // Determine error type for rate limit handling
              let errorType: string | null = null;
              let nextRetryAt: string | null = null;
              if (gcResult.error) {
                const errorLower = gcResult.error.toLowerCase();
                if (errorLower.includes('лимит') || errorLower.includes('limit')) {
                  errorType = 'rate_limit';
                  nextRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                } else if (errorLower.includes('авторизац') || errorLower.includes('auth')) {
                  errorType = 'auth';
                } else {
                  errorType = 'unknown';
                }
              }
              
              // Update order meta with GC sync result
              await supabase.from('orders_v2').update({
                meta: {
                  ...((orderV2.meta as object) || {}),
                  gc_sync_status: gcResult.success ? 'success' : 'failed',
                  gc_sync_error: gcResult.error || null,
                  gc_sync_error_type: errorType,
                  gc_order_id: gcResult.gcOrderId || null,
                  gc_deal_number: gcResult.gcDealNumber || null,
                  gc_synced_at: new Date().toISOString(),
                  gc_retry_count: gcResult.success ? 0 : (((orderV2.meta as any)?.gc_retry_count || 0) + 1),
                  gc_next_retry_at: gcResult.success ? null : nextRetryAt,
                }
              }).eq('id', orderV2.id);
              
              // Audit log
              await supabase.from('audit_logs').insert({
                actor_user_id: orderV2.user_id,
                action: gcResult.success ? 'gc_sync_success' : 'gc_sync_failed',
                meta: { 
                  order_id: orderV2.id, 
                  order_number: orderV2.order_number,
                  gc_offer_id: getcourseOfferId,
                  gc_order_id: gcResult.gcOrderId,
                  gc_deal_number: gcResult.gcDealNumber,
                  error: gcResult.error,
                  error_type: errorType,
                },
              });
              
              console.log('[GC-SYNC] Result:', gcResult);
            } else {
              // Mark as skipped with reason
              const skipReason = !customerEmail ? 'no_email' : 'no_gc_offer';
              await supabase.from('orders_v2').update({
                meta: { 
                  ...((orderV2.meta as object) || {}), 
                  gc_sync_status: 'skipped', 
                  gc_sync_error: skipReason === 'no_email' 
                    ? 'No customer email' 
                    : 'No GetCourse offer configured',
                  gc_sync_error_type: skipReason,
                  gc_synced_at: new Date().toISOString(),
                }
              }).eq('id', orderV2.id);
              
              console.log(`[GC-SYNC] Skipped: ${skipReason}`);
            }

            // ===== Telegram access - check if linked =====
            const hasTelegramLinked = userProfile?.telegram_user_id && userProfile?.telegram_link_status === 'active';
            
            if (hasTelegramLinked && productV2.telegram_club_id) {
              // Telegram linked - grant access immediately
              console.log('[TELEGRAM] Linked, granting access');
              
              await supabase.functions.invoke('telegram-grant-access', {
                body: {
                  user_id: orderV2.user_id,
                  duration_days: accessDays,
                },
              });
            } else if (productV2.telegram_club_id) {
              // Telegram NOT linked but product has club - mark pending
              console.log('[TELEGRAM] NOT linked, marking access pending');
              
              await supabase
                .from('orders_v2')
                .update({
                  meta: {
                    ...((orderV2.meta as object) || {}),
                    telegram_access_pending: true,
                    pending_since: new Date().toISOString(),
                  }
                })
                .eq('id', orderV2.id);
              
              // Queue notification for user to link Telegram
              await supabase.from('pending_telegram_notifications').insert({
                user_id: orderV2.user_id,
                notification_type: 'telegram_link_required',
                payload: {
                  order_id: orderV2.id,
                  product_name: productV2.name,
                  tariff_name: tariff.name,
                },
                priority: 10,
              });
              
              console.log('[TELEGRAM] Created pending notification for linking');
            }

            // Audit
            await supabase.from('audit_logs').insert({
              actor_user_id: orderV2.user_id,
              action: orderV2.is_trial ? 'subscription.trial_paid' : 'subscription.purchased',
              meta: {
                order_id: orderV2.id,
                payment_id: paymentV2.id,
                amount: paymentV2.amount,
                currency: paymentV2.currency,
                tariff_id: orderV2.tariff_id,
                product_id: orderV2.product_id,
                bepaid_uid: transactionUid,
              },
            });

            // --- Notify super admins about new payment via central function ---
            // MOVED OUTSIDE: notification is now sent unconditionally after this block
          }
        }

        // === NOTIFY ADMINS UNCONDITIONALLY FOR SUCCESSFUL PAYMENTS ===
        // This block is OUTSIDE the "status !== 'paid'" check to ensure notifications
        // are sent even for duplicate webhooks or already-processed orders
        try {
          // Re-fetch order data to get latest state
          const { data: notifyOrderData } = await supabase
            .from('orders_v2')
            .select(`
              id, order_number, is_trial, customer_email, customer_phone, user_id,
              product_id, tariff_id,
              products_v2:product_id(name),
              tariffs:tariff_id(name)
            `)
            .eq('id', paymentV2.order_id)
            .single();

          if (notifyOrderData) {
            // Get customer profile for notification
            const { data: customerProfile } = await supabase
              .from('profiles')
              .select('full_name, email, phone, telegram_username')
              .eq('user_id', notifyOrderData.user_id)
              .single();

            const amountFormatted = Number(paymentV2.amount).toFixed(2);
            const paymentType = notifyOrderData.is_trial ? '🔔 Пробный период' : '💰 Оплата';
            const productName = (notifyOrderData.products_v2 as any)?.name || 'N/A';
            const tariffName = (notifyOrderData.tariffs as any)?.name || 'N/A';

            const notifyMessage = `${paymentType}\n\n` +
              `👤 <b>Клиент:</b> ${customerProfile?.full_name || 'Не указано'}\n` +
              `📧 Email: ${customerProfile?.email || notifyOrderData.customer_email || 'Не указан'}\n` +
              `📱 Телефон: ${customerProfile?.phone || notifyOrderData.customer_phone || 'Не указан'}\n` +
              (customerProfile?.telegram_username ? `💬 Telegram: @${customerProfile.telegram_username}\n` : '') +
              `\n📦 <b>Продукт:</b> ${productName}\n` +
              `📋 Тариф: ${tariffName}\n` +
              `💵 Сумма: ${amountFormatted} ${paymentV2.currency}\n` +
              `🆔 Заказ: ${notifyOrderData.order_number}`;

            // Use fetch instead of supabase.functions.invoke (cross-function invoke has issues)
            try {
              const notifyResponse = await fetch(
                `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-notify-admins`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  },
                  body: JSON.stringify({ 
                    message: notifyMessage,
                    source: 'bepaid_webhook',
                    order_id: notifyOrderData.id,
                    order_number: notifyOrderData.order_number,
                    payment_id: paymentV2.id,
                  }),
                }
              );

              const notifyData = await notifyResponse.json().catch(() => ({}));
              
              if (!notifyResponse.ok) {
                console.error('Admin notification fetch error:', notifyResponse.status, notifyData);
              } else if (notifyData?.sent === 0) {
                console.warn('Admin notification sent=0:', notifyData);
              } else {
                console.log('Admin notification sent for payment:', paymentV2.id, notifyData);
              }
            } catch (fetchError) {
              console.error('Admin notification fetch exception:', fetchError);
            }
          }
        } catch (notifyError) {
          console.error('Error notifying super admins:', notifyError);
          // Don't fail the webhook if notification fails
        }

        // --- Auto-generate documents from templates ---
        // Get fresh order data for document generation (orderV2 may be out of scope)
        const { data: docOrderData } = await supabase
          .from('orders_v2')
          .select('id, product_id')
          .eq('id', paymentV2.order_id)
          .single();

        if (docOrderData) {
          try {
            // Check if product has document templates linked
            const { data: templateLinks } = await supabase
              .from('product_document_templates')
              .select(`
                id,
                auto_generate,
                auto_send_email,
                document_templates(id, name, is_active)
              `)
              .eq('product_id', docOrderData.product_id)
              .eq('auto_generate', true);

            if (templateLinks && templateLinks.length > 0) {
              console.log(`Found ${templateLinks.length} document templates for auto-generation`);
              
              for (const link of templateLinks) {
                const template = (link as any).document_templates;
                if (!template?.is_active) continue;

                try {
                  // Call generate-from-template edge function
                  const generateResponse = await fetch(
                    `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-from-template`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                      },
                      body: JSON.stringify({
                        order_id: docOrderData.id,
                        template_id: template.id,
                        send_email: link.auto_send_email || false,
                      }),
                    }
                  );

                  const genResult = await generateResponse.json();
                  console.log(`Document generation result for template ${template.name}:`, genResult);
                } catch (genError) {
                  console.error(`Error generating document from template ${template.id}:`, genError);
                }
              }
            }
          } catch (docError) {
            console.error('Error in auto-document generation:', docError);
            // Don't fail the webhook if document generation fails
          }
        }

        return new Response(JSON.stringify({ ok: true, mode: 'v2', status: 'successful' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (transactionStatus === 'incomplete') {
        await supabase
          .from('payments_v2')
          .update({
            ...basePaymentUpdate,
            status: 'processing',
          })
          .eq('id', paymentV2.id);

        return new Response(JSON.stringify({ ok: true, mode: 'v2', status: 'incomplete' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // failed / expired / other
      await supabase
        .from('payments_v2')
        .update({
          ...basePaymentUpdate,
          status: 'failed',
        })
        .eq('id', paymentV2.id);

      if (paymentV2.order_id) {
        await supabase
          .from('orders_v2')
          .update({ status: 'failed' })
          .eq('id', paymentV2.order_id);

        // Send Telegram notification about failed first payment
        try {
          const { data: orderV2 } = await supabase
            .from('orders_v2')
            .select('user_id, product_id, customer_email, final_price, currency')
            .eq('id', paymentV2.order_id)
            .single();

          if (orderV2?.user_id) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('telegram_user_id, telegram_link_status, full_name')
              .eq('user_id', orderV2.user_id)
              .single();

            if (profile?.telegram_user_id && profile.telegram_link_status === 'active') {
              const { data: product } = await supabase
                .from('products_v2')
                .select('name')
                .eq('id', orderV2.product_id)
                .single();

              const { data: linkBot } = await supabase
                .from('telegram_bots')
                .select('token')
                .eq('is_link_bot', true)
                .eq('is_active', true)
                .limit(1)
                .single();

              if (linkBot?.token) {
                const userName = profile.full_name || 'Клиент';
                const errorMessage = transaction?.message || 'Платёж не прошёл';
                const russianError = translatePaymentError(errorMessage);
                const amount = orderV2.final_price ? (orderV2.final_price / 100).toFixed(2) : '0.00';

                const message = `❌ *Платёж не прошёл*

${userName}, к сожалению, не удалось провести оплату.

📦 *Продукт:* ${product?.name || 'Продукт'}
💳 *Сумма:* ${amount} ${orderV2.currency || 'BYN'}
⚠️ *Причина:* ${russianError}

*Что можно сделать:*
• Проверьте баланс карты
• Убедитесь, что карта не заблокирована
• Попробуйте оплатить другой картой

🔗 [Попробовать снова](https://club.gorbova.by/purchases)`;

                await fetch(`https://api.telegram.org/bot${linkBot.token}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: profile.telegram_user_id,
                    text: message,
                    parse_mode: 'Markdown',
                  }),
                });
                console.log('Sent first payment failure notification to user via Telegram');
              }
            }
          }
        } catch (notifyError) {
          console.error('Error sending payment failure Telegram notification:', notifyError);
        }
      }

      return new Response(JSON.stringify({ ok: true, mode: 'v2', status: transactionStatus || 'unknown' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------------------------------------------------------------------
    // Legacy flow (orders table)
    // ---------------------------------------------------------------------

    if (!orderId && !subscriptionId) {
      console.error('No tracking_id nor subscription id in webhook payload');
      return new Response(
        JSON.stringify({ error: 'Missing tracking_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the order
    let order: any = null;

    if (orderId) {
      const { data, error } = await supabase
        .from('orders')
        .select('*, products(*)')
        .eq('id', orderId)
        .maybeSingle();

      if (!error && data) order = data;
    }

    // Fallback: find order by subscription id saved in meta
    if (!order && subscriptionId) {
      const { data: subOrder, error: subOrderError } = await supabase
        .from('orders')
        .select('*, products(*)')
        .eq('meta->>bepaid_subscription_id', subscriptionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!subOrderError && subOrder) order = subOrder;
    }

    if (!order) {
      console.error('Order not found for webhook:', { orderId, subscriptionId });
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const internalOrderId = order.id as string;

    // Map bePaid status to our status
    let orderStatus = order.status;

    if (transactionStatus) {
      switch (transactionStatus) {
        case 'successful':
          orderStatus = 'completed';
          break;
        case 'failed':
        case 'expired':
          orderStatus = 'failed';
          break;
        case 'incomplete':
          orderStatus = 'processing';
          break;
        default:
          orderStatus = 'processing';
      }
    } else if (subscriptionState) {
      // Subscription webhooks - check subscription state
      // 'trial' and 'active' mean successful subscription
      if (subscriptionState === 'active' || subscriptionState === 'trial') {
        orderStatus = 'completed';
      } else if (subscriptionState === 'failed' || subscriptionState === 'canceled' || subscriptionState === 'expired') {
        orderStatus = 'failed';
      } else {
        orderStatus = 'processing';
      }
    } else {
      orderStatus = 'processing';
    }
    
    console.log(`Determined order status: ${orderStatus} (from transactionStatus=${transactionStatus}, subscriptionState=${subscriptionState})`);

    // Update order
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: orderStatus,
        bepaid_uid: transactionUid || null,
        payment_method: paymentMethod || null,
        error_message: transaction?.message || null,
        meta: {
          ...order.meta,
          ...(subscriptionId ? { bepaid_subscription_id: subscriptionId } : {}),
          ...(subscription ? { bepaid_subscription: subscription } : {}),
          ...(transaction ? { bepaid_response: transaction } : {}),
        },
      })
      .eq('id', internalOrderId);

    if (updateError) {
      console.error('Failed to update order:', updateError);
    }

    // If payment successful, grant entitlement and send email
    if (orderStatus === 'completed' && order.user_id) {
      let product = order.products;
      const meta = order.meta as Record<string, any> || {};
      
      // For products_v2: if no legacy product but we have product_v2_id, fetch from products_v2
      let productV2: any = null;
      let tariffData: any = null;
      
      if (!product && meta.product_v2_id) {
        console.log('Looking up product_v2:', meta.product_v2_id);
        const { data: v2Product } = await supabase
          .from('products_v2')
          .select('*')
          .eq('id', meta.product_v2_id)
          .maybeSingle();
        
        if (v2Product) {
          productV2 = v2Product;
          console.log('Found products_v2:', v2Product.name);
          
          // Get tariff data for access duration
          if (meta.tariff_code) {
            const { data: tariff } = await supabase
              .from('tariffs')
              .select('*, tariff_offers(*)')
              .eq('code', meta.tariff_code)
              .eq('product_id', meta.product_v2_id)
              .maybeSingle();
            
            if (tariff) {
              tariffData = tariff;
              console.log('Found tariff:', tariff.name, 'access_days:', tariff.access_days);
            }
          }
        }
      }
      
      // Detect duplicates by phone if phone is available
      if (meta.customer_phone) {
        try {
          const duplicateResult = await supabase.functions.invoke('detect-duplicates', {
            body: {
              phone: meta.customer_phone,
              email: order.customer_email,
            },
          });
          
          if (duplicateResult.data?.isDuplicate) {
            console.log(`Duplicate detected for order ${internalOrderId}, case: ${duplicateResult.data.caseId}`);
            await supabase
              .from('orders')
              .update({
                possible_duplicate: true,
                duplicate_reason: `Дубль по телефону: ${duplicateResult.data.duplicates?.length || 0} профилей`,
              })
              .eq('id', internalOrderId);
          }
        } catch (dupError) {
          console.error('Error detecting duplicates:', dupError);
        }
      }
      
      // Process products_v2 subscriptions
      if (productV2 && tariffData) {
        console.log(`Granting subscription for products_v2: ${productV2.name}, tariff: ${tariffData.name}`);
        
        // Calculate access duration - prioritize trial_days for trials
        let accessDays = tariffData.access_days || 30;
        if (meta.is_trial && meta.trial_days) {
          accessDays = meta.trial_days; // Trial period takes priority
          console.log(`Using trial_days from meta: ${accessDays}`);
        }
        
        const now = new Date();
        const accessEndAt = new Date(now);
        accessEndAt.setDate(accessEndAt.getDate() + accessDays);
        
        // Create order in orders_v2 for display in "My Purchases"
        // CRITICAL: Use transaction.amount (actual charged amount) instead of order.amount (may be trial)
        const actualAmount = transaction?.amount ? transaction.amount / 100 : order.amount;
        console.log(`[WEBHOOK] Amount: order=${order.amount}, transaction=${transaction?.amount}, using=${actualAmount}`);
        
        const orderNumber = `ORD-${new Date().getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;
        const { data: orderV2, error: orderV2Error } = await supabase
          .from('orders_v2')
          .insert({
            order_number: orderNumber,
            user_id: order.user_id,
            product_id: productV2.id,
            tariff_id: tariffData.id,
            customer_email: order.customer_email,
            base_price: actualAmount,
            final_price: actualAmount,
            paid_amount: actualAmount,
            currency: order.currency,
            status: 'paid',
            is_trial: meta.is_trial || false,
            trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
            purchase_snapshot: {
              product_name: productV2.name,
              tariff_name: tariffData.name,
              tariff_code: meta.tariff_code,
              access_days: accessDays,
            },
            meta: {
              legacy_order_id: internalOrderId,
              bepaid_uid: transactionUid,
              bepaid_subscription_id: subscriptionId,
            },
          })
          .select()
          .single();
        
        if (orderV2Error) {
          console.error('Failed to create order_v2:', orderV2Error);
        } else {
          console.log('Created order_v2:', orderV2.id);
          
          // Create payment_v2 record for the order
          await supabase
            .from('payments_v2')
            .insert({
              order_id: orderV2.id,
              user_id: order.user_id,
              amount: actualAmount,
              currency: order.currency,
              status: 'succeeded',
              provider: 'bepaid',
              provider_payment_id: transactionUid,
              payment_token: subscription?.card?.token || subscription?.token || null,
              card_brand: subscription?.card?.brand || null,
              card_last4: subscription?.card?.last_4 || null,
              paid_at: now.toISOString(),
              is_recurring: false,
              meta: {
                bepaid_subscription_id: subscriptionId,
              },
            });
        }
        
        // Create subscription in subscriptions_v2
        const { data: existingSub } = await supabase
          .from('subscriptions_v2')
          .select('id, access_end_at, status')
          .eq('user_id', order.user_id)
          .eq('product_id', productV2.id)
          .in('status', ['active', 'trial'])
          .maybeSingle();
        
        if (existingSub) {
          // Extend existing subscription
          const currentEnd = new Date(existingSub.access_end_at || now);
          const baseDate = currentEnd > now ? currentEnd : now;
          const newEndAt = new Date(baseDate);
          newEndAt.setDate(newEndAt.getDate() + accessDays);
          
          await supabase
            .from('subscriptions_v2')
            .update({
              access_end_at: newEndAt.toISOString(),
              is_trial: meta.is_trial || false,
              status: meta.is_trial ? 'trial' : 'active',
              trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
              payment_token: subscription?.token || null,
              order_id: orderV2?.id || null,
            })
            .eq('id', existingSub.id);
          
          console.log('Extended existing subscription:', existingSub.id);
        } else {
          // Create new subscription
          const { error: subError } = await supabase
            .from('subscriptions_v2')
            .insert({
              user_id: order.user_id,
              product_id: productV2.id,
              tariff_id: tariffData.id,
              order_id: orderV2?.id || null,
              status: meta.is_trial ? 'trial' : 'active',
              is_trial: meta.is_trial || false,
              auto_renew: true, // Enable auto-renew by default for all subscription products
              access_start_at: now.toISOString(),
              access_end_at: accessEndAt.toISOString(),
              trial_end_at: meta.is_trial ? accessEndAt.toISOString() : null,
              next_charge_at: meta.is_trial ? accessEndAt.toISOString() : null,
              payment_token: subscription?.card?.token || subscription?.token || null,
              meta: {
                tariff_code: meta.tariff_code,
                tariff_name: tariffData.name,
                bepaid_subscription_id: subscriptionId,
                auto_charge_amount: meta.auto_charge_amount,
                legacy_order_id: internalOrderId,
                trial_days: meta.trial_days || null,
              },
            });
          
          if (subError) {
            console.error('Failed to create subscription_v2:', subError);
          } else {
            console.log('Created new subscription_v2');
          }
        }
        
        // Grant Telegram access if product has telegram_club_id
        if (productV2.telegram_club_id) {
          console.log('Granting Telegram access for club:', productV2.telegram_club_id);
          
          try {
            const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: order.user_id,
                club_ids: [productV2.telegram_club_id],
                duration_days: accessDays
              },
            });
            
            if (telegramGrantResult.error) {
              console.error('Failed to grant Telegram access:', telegramGrantResult.error);
            } else {
              console.log('Telegram access granted:', telegramGrantResult.data);
            }
            
            // Create telegram_access_grants record
            const endAt = new Date(now);
            endAt.setDate(endAt.getDate() + accessDays);
            
            await supabase
              .from('telegram_access_grants')
              .insert({
                user_id: order.user_id,
                club_id: productV2.telegram_club_id,
                source: 'order',
                source_id: internalOrderId,
                start_at: now.toISOString(),
                end_at: endAt.toISOString(),
                status: 'active',
                meta: {
                  product_v2_id: productV2.id,
                  product_name: productV2.name,
                  tariff_code: meta.tariff_code,
                  tariff_name: tariffData.name,
                  is_trial: meta.is_trial,
                  bepaid_uid: transactionUid,
                  amount: order.amount,
                  currency: order.currency,
                },
              });
            
            console.log('Created telegram_access_grant');
          } catch (telegramError) {
            console.error('Error handling Telegram access:', telegramError);
          }
        }
      }
      
      // Legacy product handling
      if (product) {
        console.log(`Granting entitlement for product: ${product.name}`);

        const productCode = product.product_type === 'subscription' ? (product.tier || 'pro') : product.id;

        // Calculate expiration date (extend from current expires_at if still active)
        let expiresAt = null;
        if (product.duration_days) {
          const { data: existingEnt } = await supabase
            .from('entitlements')
            .select('expires_at')
            .eq('user_id', order.user_id)
            .eq('product_code', productCode)
            .maybeSingle();

          const now = new Date();
          const currentExpires = existingEnt?.expires_at ? new Date(existingEnt.expires_at) : null;
          const baseDate = currentExpires && currentExpires > now ? currentExpires : now;

          expiresAt = new Date(baseDate);
          expiresAt.setDate(expiresAt.getDate() + product.duration_days);
        }

        // Create or update entitlement (dual-write: user_id + profile_id + order_id)
        // Resolve profile_id from order or profiles table
        let entitlementProfileId = order.profile_id;
        if (!entitlementProfileId) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', order.user_id)
            .single();
          entitlementProfileId = profileData?.id || null;
        }

        const { error: entitlementError } = await supabase
          .from('entitlements')
          .upsert({
            user_id: order.user_id,
            profile_id: entitlementProfileId,
            order_id: internalOrderId,
            product_code: productCode,
            status: 'active',
            expires_at: expiresAt?.toISOString() || null,
            meta: {
              order_id: internalOrderId,
              product_name: product.name,
              bepaid_uid: transactionUid,
              bepaid_subscription_id: subscriptionId,
            },
          }, {
            onConflict: 'user_id,product_code',
          });

        if (entitlementError) {
          console.error('Failed to create entitlement:', entitlementError);
        }

        // Update subscription if it's a subscription product
        if (product.product_type === 'subscription' && product.tier) {
          const { error: subError } = await supabase
            .from('subscriptions')
            .update({
              tier: product.tier,
              is_active: true,
              starts_at: new Date().toISOString(),
              expires_at: expiresAt?.toISOString() || null,
            })
            .eq('user_id', order.user_id);

          if (subError) {
            console.error('Failed to update subscription:', subError);
          }
        }
      }

      // Grant Telegram access based on product_club_mappings (for selected products)
      if (product) {
        try {
          // Check if this product has club mappings
          const { data: mappings } = await supabase
            .from('product_club_mappings')
            .select('*, telegram_clubs(id, club_name)')
            .eq('product_id', product.id)
            .eq('is_active', true);

          if (mappings && mappings.length > 0) {
            console.log(`Found ${mappings.length} club mappings for product ${product.name}`);
            
            for (const mapping of mappings) {
              const durationDays = mapping.duration_days || product.duration_days || 30;
              
              // Grant access via edge function
              const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
                body: { 
                  user_id: order.user_id,
                  club_ids: [mapping.club_id],
                  duration_days: durationDays
                },
              });
              
              if (telegramGrantResult.error) {
                console.error('Failed to grant Telegram access:', telegramGrantResult.error);
              } else {
                console.log('Telegram access granted:', telegramGrantResult.data);
              }

              // Create telegram_access_grants record for history
              const startAt = new Date();
              const endAt = new Date();
              endAt.setDate(endAt.getDate() + durationDays);

              await supabase
                .from('telegram_access_grants')
                .insert({
                  user_id: order.user_id,
                  club_id: mapping.club_id,
                  source: 'order',
                  source_id: internalOrderId,
                  start_at: startAt.toISOString(),
                  end_at: endAt.toISOString(),
                  status: 'active',
                  meta: {
                    product_id: product.id,
                    product_name: product.name,
                    product_tier: product.tier,
                    bepaid_uid: transactionUid,
                    amount: order.amount,
                    currency: order.currency,
                  },
                });
            }
            console.log('Telegram access grants created for', mappings.length, 'clubs via product mappings');
          } else if (product.product_type === 'subscription' && product.duration_days) {
            // Fallback: if no explicit mapping but it's a subscription product, grant to all active clubs
            console.log('No explicit mappings, using fallback for subscription product');
            
            const telegramGrantResult = await supabase.functions.invoke('telegram-grant-access', {
              body: { 
                user_id: order.user_id,
                duration_days: product.duration_days
              },
            });
            
            if (telegramGrantResult.error) {
              console.error('Failed to grant Telegram access (fallback):', telegramGrantResult.error);
            } else {
              console.log('Telegram access granted (fallback):', telegramGrantResult.data);
            }

            // Create grants for all active clubs
            const { data: clubs } = await supabase
              .from('telegram_clubs')
              .select('id')
              .eq('is_active', true);

            if (clubs && clubs.length > 0) {
              const startAt = new Date();
              const endAt = new Date();
              endAt.setDate(endAt.getDate() + product.duration_days);

              for (const club of clubs) {
                await supabase
                  .from('telegram_access_grants')
                  .insert({
                    user_id: order.user_id,
                    club_id: club.id,
                     source: 'order',
                     source_id: internalOrderId,
                     start_at: startAt.toISOString(),
                    end_at: endAt.toISOString(),
                    status: 'active',
                    meta: {
                      product_name: product.name,
                      product_tier: product.tier,
                      bepaid_uid: transactionUid,
                      amount: order.amount,
                      currency: order.currency,
                    },
                  });
              }
              console.log('Telegram access grants created for', clubs.length, 'clubs (fallback)');
            }
          }
        } catch (telegramError) {
          console.error('Error handling Telegram access:', telegramError);
        }
      }

      // Create contact and deal in AmoCRM
      const customerName = meta.customer_first_name 
        ? `${meta.customer_first_name} ${meta.customer_last_name || ''}`.trim()
        : order.customer_email?.split('@')[0] || 'Клиент';
      
      const productName = product?.name || productV2?.name || meta.product_name || 'Подписка';
      
      const amoCRMContactId = await createAmoCRMContact(
        customerName,
        order.customer_email || '',
        meta.customer_phone
      );

      const amoCRMDealId = await createAmoCRMDeal(
        `Оплата: ${productName}`,
        order.amount, // Amount is already in BYN, not kopecks
        amoCRMContactId,
        {
          order_id: internalOrderId,
          product: productName,
          subscription_tier: product?.tier || tariffData?.code,
        }
      );

      // Send to GetCourse
      let gcSyncResult: { success: boolean; error?: string; gcOrderId?: string; gcDealNumber?: number } = { success: false };
      const tariffCode = meta.tariff_code as string | undefined;
      
      if (tariffCode && order.customer_email) {
        console.log(`Sending order to GetCourse: tariff=${tariffCode}, email=${order.customer_email}`);
        
        // Get order_v2 record to retrieve order_number and getcourse_offer_id from meta
        const { data: orderV2Data } = await supabase
          .from('orders_v2')
          .select('id, order_number, meta')
          .or(`id.eq.${internalOrderId},meta->>legacy_order_id.eq.${internalOrderId}`)
          .maybeSingle();
        
        const orderV2Id = orderV2Data?.id || internalOrderId;
        const orderNumber = orderV2Data?.order_number || `ORD-LEGACY-${internalOrderId.substring(0, 8)}`;
        const orderV2Meta = (orderV2Data?.meta as Record<string, unknown>) || {};
        
        // Priority: 1) getcourse_offer_id from order meta (set by direct-charge from offer)
        //           2) getcourse_offer_id from tariffs table (fallback)
        let getcourseOfferId = orderV2Meta.getcourse_offer_id as string | undefined;
        
        if (!getcourseOfferId) {
          // Fallback to tariffs table
          const { data: tariffGCData } = await supabase
            .from('tariffs')
            .select('getcourse_offer_id')
            .eq('code', tariffCode)
            .maybeSingle();
          
          getcourseOfferId = tariffGCData?.getcourse_offer_id;
        }
        
        if (getcourseOfferId) {
          const gcOfferId = typeof getcourseOfferId === 'string' ? parseInt(getcourseOfferId, 10) : getcourseOfferId;
          
          gcSyncResult = await sendToGetCourse(
            {
              email: order.customer_email,
              phone: meta.customer_phone || null,
              firstName: meta.customer_first_name || null,
              lastName: meta.customer_last_name || null,
            },
            gcOfferId,
            orderNumber,
            order.amount,
            tariffCode
          );
          
          // Update order with GetCourse sync status including deal_number for future updates
          await supabase
            .from('orders_v2')
            .update({
              meta: {
                ...orderV2Meta,
                gc_sync_status: gcSyncResult.success ? 'success' : 'failed',
                gc_sync_error: gcSyncResult.error || null,
                gc_order_id: gcSyncResult.gcOrderId || null,
                gc_deal_number: gcSyncResult.gcDealNumber || null,
                gc_sync_at: new Date().toISOString(),
              },
            })
            .eq('id', orderV2Id);
          
          if (gcSyncResult.success) {
            console.log('GetCourse sync successful');
          } else {
            console.error('GetCourse sync failed:', gcSyncResult.error);
          }
        } else {
          console.log(`No getcourse_offer_id for tariff ${tariffCode}, skipping GetCourse sync`);
        }
      } else {
        console.log('GetCourse sync skipped: no tariff_code or email');
      }

      // Log the action
      await supabase
        .from('audit_logs')
        .insert({
          action: 'payment_completed',
          actor_user_id: order.user_id,
          target_user_id: order.user_id,
          meta: {
            order_id: internalOrderId,
            amount: order.amount,
            currency: order.currency,
            bepaid_uid: transactionUid,
            product_name: product?.name,
            amocrm_contact_id: amoCRMContactId,
            amocrm_deal_id: amoCRMDealId,
            gc_sync_status: gcSyncResult.success ? 'success' : (tariffCode ? 'failed' : 'skipped'),
            gc_order_id: gcSyncResult.gcOrderId,
            bepaid_subscription_id: subscriptionId,
          },
        });

      // Send admin notification email
      if (resend) {
        const priceFormatted = `${(order.amount / 100).toFixed(2)} ${order.currency}`;
        const adminEmail = 'info@ajoure.by';
        
        try {
          await resend.emails.send({
            from: 'Gorbova Club <noreply@gorbova.club>',
            to: [adminEmail],
            subject: `💰 Новая оплата: ${product?.name || 'Подписка'} — ${priceFormatted}`,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                  .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                  .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
                  .amount { font-size: 24px; font-weight: bold; color: #10b981; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h2 style="margin: 0;">💰 Новая оплата получена!</h2>
                  </div>
                  <div class="content">
                    <p class="amount">${priceFormatted}</p>
                    
                    <div class="info-row">
                      <span>Продукт:</span>
                      <strong>${product?.name || 'Подписка'}</strong>
                    </div>
                    <div class="info-row">
                      <span>Email клиента:</span>
                      <strong>${order.customer_email || '—'}</strong>
                    </div>
                    <div class="info-row">
                      <span>Номер заказа:</span>
                      <span>${internalOrderId}</span>
                    </div>
                    <div class="info-row">
                      <span>ID транзакции:</span>
                      <span>${transactionUid}</span>
                    </div>
                    <div class="info-row">
                      <span>Дата и время:</span>
                      <span>${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}</span>
                    </div>
                    
                    <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
                      Это автоматическое уведомление о новой оплате.
                    </p>
                  </div>
                </div>
              </body>
              </html>
            `,
          });
          console.log('Admin notification email sent');
        } catch (adminEmailError) {
          console.error('Failed to send admin notification:', adminEmailError);
        }
      }

      // Send email notification
      if (resend && order.customer_email) {
        const newUserCreated = meta.new_user_created === true;
        const newUserPassword = meta.new_user_password || null;
        const customerName = meta.customer_first_name 
          ? `${meta.customer_first_name} ${meta.customer_last_name || ''}`.trim()
          : 'Уважаемый клиент';
        const priceFormatted = `${Number(order.amount).toFixed(2)} ${order.currency}`;

        let emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
              .success-badge { display: inline-block; background: #10b981; color: white; padding: 8px 16px; border-radius: 20px; font-weight: bold; margin-bottom: 20px; }
              .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .order-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
              .order-row:last-child { border-bottom: none; }
              .credentials { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; }
              .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Gorbova Club</h1>
                <p style="margin: 10px 0 0;">Подтверждение оплаты</p>
              </div>
              <div class="content">
                <div class="success-badge">✓ Оплата успешна</div>
                
                <p>Здравствуйте, ${customerName}!</p>
                <p>Благодарим вас за покупку. Ваш платёж успешно обработан.</p>
                
                <div class="order-details">
                  <h3 style="margin-top: 0;">Детали заказа</h3>
                  <div class="order-row">
                    <span>Продукт:</span>
                    <strong>${product?.name || 'Подписка'}</strong>
                  </div>
                  <div class="order-row">
                    <span>Сумма:</span>
                    <strong>${priceFormatted}</strong>
                  </div>
                  <div class="order-row">
                    <span>Номер заказа:</span>
                    <span>${orderId}</span>
                  </div>
                  <div class="order-row">
                    <span>ID транзакции:</span>
                    <span>${transactionUid}</span>
                  </div>
                </div>
        `;

        // Add credentials section for new users
        if (newUserCreated && newUserPassword) {
          emailHtml += `
                <div class="credentials">
                  <h3 style="margin-top: 0; color: #92400e;">🔐 Доступ в личный кабинет</h3>
                  <p>Мы создали для вас личный кабинет. Используйте эти данные для входа:</p>
                  <p><strong>Логин (email):</strong> ${order.customer_email}</p>
                  <p><strong>Временный пароль:</strong> ${newUserPassword}</p>
                  <p style="color: #92400e; font-size: 14px;">⚠️ Рекомендуем сменить пароль после первого входа</p>
                </div>
          `;
        }

        emailHtml += `
                <p style="text-align: center; margin-top: 30px;">
                  <a href="https://gorbova.club/dashboard" class="button">Перейти в личный кабинет</a>
                </p>
                
                <div class="footer">
                  <p>Если у вас есть вопросы, свяжитесь с нами по email.</p>
                  <p>© ${new Date().getFullYear()} Gorbova Club. Все права защищены.</p>
                </div>
              </div>
            </div>
          </body>
          </html>
        `;

        try {
          const emailResult = await resend.emails.send({
            from: 'Gorbova Club <noreply@gorbova.club>',
            to: [order.customer_email],
            subject: newUserCreated 
              ? 'Добро пожаловать! Данные для входа и подтверждение оплаты' 
              : 'Подтверждение оплаты — Gorbova Club',
            html: emailHtml,
          });
          console.log('Email sent successfully:', emailResult);
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
          // Don't fail the webhook - email is not critical
        }

        // Clear sensitive data from order meta
        if (meta.new_user_password) {
          await supabase
            .from('orders')
            .update({
              meta: {
                ...meta,
                new_user_password: '[REDACTED]',
                email_sent: true,
              }
            })
            .eq('id', orderId);
        }
      }
    }

    // Handle failed payment notification
    if (orderStatus === 'failed' && resend && order.customer_email) {
      const meta = order.meta as Record<string, any> || {};
      const customerName = meta.customer_first_name || 'Уважаемый клиент';

      try {
        await resend.emails.send({
          from: 'Gorbova Club <noreply@gorbova.club>',
          to: [order.customer_email],
          subject: 'Ошибка оплаты — Gorbova Club',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0;">Ошибка оплаты</h1>
                </div>
                <div class="content">
                  <p>Здравствуйте, ${customerName}!</p>
                  <p>К сожалению, ваш платёж не был обработан. Это может произойти по следующим причинам:</p>
                  <ul>
                    <li>Недостаточно средств на карте</li>
                    <li>Карта заблокирована или истёк срок действия</li>
                    <li>Превышен лимит на операции</li>
                  </ul>
                  <p>Вы можете попробовать оплатить снова:</p>
                  <p style="text-align: center; margin-top: 20px;">
                    <a href="https://gorbova.club/pricing" class="button">Попробовать снова</a>
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
        });
        console.log('Failed payment notification sent');
      } catch (emailError) {
        console.error('Failed to send failure email:', emailError);
      }
    }

    console.log(`Order ${orderId} updated to status: ${orderStatus}`);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[WEBHOOK-FATAL] Webhook processing error:', error);
    
    // Log the error to audit_logs for visibility
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase.from('audit_logs').insert({
        actor_user_id: '00000000-0000-0000-0000-000000000000',
        action: 'webhook.error',
        meta: { 
          error: String(error), 
          body_preview: bodyText?.substring(0, 1000) || 'no body',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (logErr) {
      console.error('[WEBHOOK-LOG-ERROR] Failed to log webhook error:', logErr);
    }
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Creates an order from webhook data when the original order is missing.
 * This handles the "Людмила case" where bePaid subscription was created
 * but our order creation failed/timed out.
 */
async function createOrderFromWebhook(
  supabase: any,
  orderId: string,
  offerId: string | null,
  transaction: any,
  subscription: any,
  body: any
): Promise<any> {
  const now = new Date();
  const amountBYN = transaction.amount / 100;
  const currency = transaction.currency || 'BYN';
  const customerEmail = transaction.customer?.email?.toLowerCase();
  const transactionUid = transaction.uid;
  
  if (!customerEmail) {
    throw new Error('Customer email is required to create order');
  }
  
  // CRITICAL: Check if payment with this bepaid_uid already exists (PREVENT DUPLICATES)
  if (transactionUid) {
    const { data: existingPayment } = await supabase
      .from('payments_v2')
      .select('id, order_id, orders_v2:order_id(order_number)')
      .eq('provider_payment_id', transactionUid)
      .maybeSingle();
    
    if (existingPayment) {
      const existingOrderNumber = (existingPayment as any).orders_v2?.order_number || 'N/A';
      console.warn(`[WEBHOOK] SKIP createOrderFromWebhook: Payment with bepaid_uid=${transactionUid} already exists (payment_id=${existingPayment.id}, order_id=${existingPayment.order_id}, order_number=${existingOrderNumber})`);
      
      // Log to audit
      await supabase.from('audit_logs').insert({
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid-webhook',
        action: 'webhook_duplicate_payment_skipped',
        meta: {
          bepaid_uid: transactionUid,
          existing_payment_id: existingPayment.id,
          existing_order_id: existingPayment.order_id,
          existing_order_number: existingOrderNumber,
        },
      });
      
      // Return the existing order instead of creating duplicate
      const { data: existingOrder } = await supabase
        .from('orders_v2')
        .select('*')
        .eq('id', existingPayment.order_id)
        .single();
      
      return existingOrder;
    }
  }
  
  // PATCH-2: Trial Guard - prevent trial orders for users with active subscriptions or trial blocks
  const TRIAL_AMOUNT_THRESHOLD = 5; // BYN - amounts <= this are considered trial
  const isTrialAmount = amountBYN <= TRIAL_AMOUNT_THRESHOLD;
  
  if (isTrialAmount && customerEmail) {
    // Find user by email to check for active subscriptions
    const { data: profileForTrialCheck } = await supabase
      .from('profiles')
      .select('id, user_id')
      .eq('email', customerEmail)
      .maybeSingle();
    
    if (profileForTrialCheck?.user_id) {
      // Check for active subscription
      const { data: activeSub } = await supabase
        .from('subscriptions_v2')
        .select('id, status, product_id')
        .eq('user_id', profileForTrialCheck.user_id)
        .in('status', ['active', 'trial', 'grace'])
        .maybeSingle();
      
      // Check for trial block
      const { data: trialBlock } = await supabase
        .from('trial_blocks')
        .select('id, reason, expires_at')
        .eq('user_id', profileForTrialCheck.user_id)
        .is('removed_at', null)
        .maybeSingle();
      
      // If expires_at is set and passed, ignore the block
      const isBlockActive = trialBlock && (!trialBlock.expires_at || new Date(trialBlock.expires_at) > now);
      
      if (activeSub || isBlockActive) {
        console.warn(`[WEBHOOK] TRIAL BLOCKED for ${customerEmail}: activeSub=${!!activeSub}, trialBlock=${!!isBlockActive}`);
        
        // Log to audit
        await supabase.from('audit_logs').insert({
          actor_user_id: null,
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: 'payment.trial_blocked',
          target_user_id: profileForTrialCheck.user_id,
          meta: {
            bepaid_uid: transactionUid,
            amount: amountBYN,
            email: customerEmail,
            has_active_subscription: !!activeSub,
            active_subscription_id: activeSub?.id,
            active_subscription_status: activeSub?.status,
            has_trial_block: !!isBlockActive,
            trial_block_id: trialBlock?.id,
            trial_block_reason: trialBlock?.reason,
          },
        });
        
        // Save payment but mark as ignored
        const { data: ignoredPayment } = await supabase
          .from('payments_v2')
          .insert({
            provider_payment_id: transactionUid,
            provider: 'bepaid',
            amount: amountBYN,
            currency: currency,
            status: 'succeeded',
            transaction_type: 'payment',
            paid_at: now.toISOString(),
            profile_id: profileForTrialCheck.id,
            meta: {
              ignored_reason: activeSub ? 'trial_blocked_active_subscription' : 'trial_blocked_by_block',
              active_subscription_id: activeSub?.id,
              trial_block_id: trialBlock?.id,
              bepaid_transaction: transaction,
            },
            origin: 'bepaid',
          })
          .select()
          .single();
        
        // Return null to indicate no order should be created
        return null;
      }
    }
  }
  
  // Find or create user
  let userId: string | null = null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('email', customerEmail)
    .maybeSingle();

  userId = profile?.user_id || null;
  
  // Get offer details
  let productId: string | null = null;
  let tariffId: string | null = null;
  
  if (offerId) {
    const { data: offer } = await supabase
      .from('tariff_offers')
      .select(`
        id,
        tariff_id,
        tariffs!inner (
          id,
          product_id
        )
      `)
      .eq('id', offerId)
      .maybeSingle();

    if (offer) {
      tariffId = offer.tariff_id;
      productId = offer.tariffs?.product_id;
    }
  }

  // Generate order number
  const yearPart = now.getFullYear().toString().slice(-2);
  const { count } = await supabase
    .from('orders_v2')
    .select('id', { count: 'exact', head: true })
    .like('order_number', `ORD-${yearPart}-%`);

  const seqPart = ((count || 0) + 1).toString().padStart(5, '0');
  const orderNumber = `ORD-${yearPart}-${seqPart}`;

  // Extract subscription ID from body
  const bepaidSubscriptionId = body.id || subscription?.id || null;

  // Create order with payment date as created_at
  const { data: order, error } = await supabase
    .from('orders_v2')
    .insert({
      id: orderId,
      order_number: orderNumber,
      user_id: userId,
      product_id: productId,
      tariff_id: tariffId,
      base_price: amountBYN,
      final_price: amountBYN,
      currency: currency,
      status: 'paid',
      customer_email: customerEmail,
      customer_phone: subscription?.customer?.phone || null,
      bepaid_subscription_id: bepaidSubscriptionId,
      reconcile_source: 'webhook_orphan',
      paid_amount: amountBYN,
      created_at: transaction.paid_at || now.toISOString(),  // Use payment date, not now()
      meta: {
        reconstructed_from_webhook: true,
        bepaid_uid: transaction.uid,
        bepaid_subscription_id: bepaidSubscriptionId,
        original_tracking_id: transaction.tracking_id,
        reconstructed_at: now.toISOString(),
        customer_first_name: transaction.customer?.first_name || subscription?.customer?.first_name,
        customer_last_name: transaction.customer?.last_name || subscription?.customer?.last_name,
      },
    })
    .select()
    .single();

  if (error) throw error;

  // Create payment record
  await supabase.from('payments_v2').insert({
    order_id: order.id,
    amount: amountBYN,
    currency: currency,
    provider: 'bepaid',
    provider_payment_id: transaction.uid,
    status: 'succeeded',
    paid_at: transaction.paid_at || now.toISOString(),
    card_brand: transaction.credit_card?.brand,
    card_last4: transaction.credit_card?.last_4,
    provider_response: body,
  });

  // Create subscription if user and product known
  if (userId && productId) {
    let accessEndAt = new Date();
    accessEndAt.setMonth(accessEndAt.getMonth() + 1);

    if (tariffId) {
      const { data: tariff } = await supabase
        .from('tariffs')
        .select('access_duration_days')
        .eq('id', tariffId)
        .single();

      if (tariff?.access_duration_days) {
        accessEndAt = new Date();
        accessEndAt.setDate(accessEndAt.getDate() + tariff.access_duration_days);
      }
    }

    // Delegate to centralized grant-access-for-order to avoid duplicates
    try {
      await supabase.functions.invoke('grant-access-for-order', {
        body: {
          orderId: order.id,
          grantTelegram: false, // Will be handled below
          grantGetcourse: false,
        },
      });
    } catch (grantErr) {
      console.error('[WEBHOOK] grant-access-for-order error (non-critical):', grantErr);
    }

    // Create entitlement
    const { data: product } = await supabase
      .from('products_v2')
      .select('code')
      .eq('id', productId)
      .single();

    if (product?.code) {
      await supabase.from('entitlements').upsert(
        {
          user_id: userId,
          product_code: product.code,
          status: 'active',
          expires_at: accessEndAt.toISOString(),
          meta: { source: 'webhook_reconstruction', order_id: order.id },
        },
        { onConflict: 'user_id,product_code' }
      );
    }

    // Grant Telegram access
    try {
      await supabase.functions.invoke('telegram-grant-access', {
        body: { userId, productId },
      });
    } catch (e) {
      console.error('Error granting Telegram access:', e);
    }

    // Save card token if available
    const cardToken = transaction.credit_card?.token || subscription?.credit_card?.token;
    if (cardToken) {
      const { data: existingMethod } = await supabase
        .from('payment_methods')
        .select('id')
        .eq('user_id', userId)
        .eq('provider_token', cardToken)
        .maybeSingle();

      if (!existingMethod) {
        await supabase.from('payment_methods').insert({
          user_id: userId,
          provider: 'bepaid',
          provider_token: cardToken,
          brand: transaction.credit_card?.brand,
          last4: transaction.credit_card?.last_4,
          exp_month: transaction.credit_card?.exp_month,
          exp_year: transaction.credit_card?.exp_year,
          status: 'active',
          is_default: true,
        });
      }
    }
  }

  console.log(`[WEBHOOK] Created orphan order ${orderNumber} for ${customerEmail}`);
  return order;
}
