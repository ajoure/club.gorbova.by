// CANONICAL-WRITER-ONLY (PATCH H2):
// В LINK-ORDER ветке этого webhook ЗАПРЕЩЕНО прямое обновление полей доступа:
//   - subscriptions_v2.access_end_at / access_start_at / status
//   - entitlements.expires_at / status (любые insert/update)
//   - telegram_access.active_until / telegram-grant-access bypass
// Единственный writer этих полей — grant-access-for-order → telegram-grant-access.
// Допустимы только provider-sync поля subscriptions_v2: billing_type, auto_renew,
// meta.bepaid_subscription_id, meta.bepaid_activated_at. Любая новая запись в
// access-поля из webhook должна быть отвергнута на code-review.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@2.0.0';
import { endOfDayAppTz } from '../_shared/timezone.ts';
import { buildAdminNotifyMessage, maskEmail } from '../_shared/admin-notify-message.ts';
import { buildPurchaseSnapshot } from '../_shared/build-purchase-snapshot.ts';
import { applyCrmStageOnTerminal } from '../_shared/crm-routing.ts';
import { consumePaymentLinkForOrder } from '../_shared/consume-payment-link.ts';
import { generateInstallmentSchedule } from '../_shared/installment-schedule.ts';
// PATCH-RB1: REBILL materialization engine (gated by BEPAID_REBILL_MATERIALIZATION).
import { runRebillFlow } from './rebill_flow.ts';
import { resolveKillSwitchMode } from './rebill_builders.ts';
import { buildRebillDepsAdapter } from './rebill_deps_adapter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, content-signature',
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

// =====================================================================
// payments_v2 helpers: select→insert/update (avoids 42P10 with partial index)
// =====================================================================
async function findPaymentByProviderUid(supabase: any, provider: string, uid: string): Promise<{ id: string; order_id: string | null; origin: string | null } | null> {
  const { data, error } = await supabase.from('payments_v2').select('id, order_id, origin').eq('provider', provider).eq('provider_payment_id', uid).maybeSingle();
  if (error) { console.error('[payments_v2-helper] findByProviderUid error:', error.message); return null; }
  return data || null;
}

async function upsertPaymentV2(supabase: any, payload: Record<string, any>, logPrefix: string): Promise<{ id: string | null; action: 'created' | 'updated' | 'error'; error?: string }> {
  const uid = payload.provider_payment_id;
  const provider = payload.provider || 'bepaid';
  if (!uid) { console.error(`${logPrefix} SKIP: no provider_payment_id`); return { id: null, action: 'error', error: 'missing_provider_payment_id' }; }

  // Shared helper: build COALESCE-style update fields + meta-merge
  const buildUpdateFields = async (targetId: string): Promise<Record<string, any>> => {
    const fields: Record<string, any> = {};
    for (const key of ['order_id','user_id','profile_id','amount','currency','status','card_holder','card_last4','card_brand','error_message','origin','paid_at','is_recurring','receipt_url','product_name_raw','provider_response']) {
      if (payload[key] !== undefined && payload[key] !== null) fields[key] = payload[key];
    }
    if (payload.meta && typeof payload.meta === 'object' && Object.keys(payload.meta).length > 0) {
      const { data: cur } = await supabase.from('payments_v2').select('meta').eq('id', targetId).maybeSingle();
      fields.meta = { ...((cur?.meta && typeof cur.meta === 'object') ? cur.meta : {}), ...payload.meta };
    }
    return fields;
  };

  const existing = await findPaymentByProviderUid(supabase, provider, uid);
  if (existing) {
    const updateFields = await buildUpdateFields(existing.id);
    const { error: updErr } = await supabase.from('payments_v2').update(updateFields).eq('id', existing.id);
    if (updErr) { console.error(`${logPrefix} update error:`, updErr.message); return { id: existing.id, action: 'error', error: updErr.message }; }
    console.log(`${logPrefix} updated existing payment:`, existing.id);
    return { id: existing.id, action: 'updated' };
  }

  // Insert without .select().single() — get id via findPaymentByProviderUid after
  const { error: insErr } = await supabase.from('payments_v2').insert(payload);
  if (insErr) {
    if (insErr.code === '23505') {
      console.warn(`${logPrefix} 23505 race → fallback coalesce-update`);
      const re = await findPaymentByProviderUid(supabase, provider, uid);
      if (re) {
        const raceFields = await buildUpdateFields(re.id);
        const { error: rErr } = await supabase.from('payments_v2').update(raceFields).eq('id', re.id);
        if (rErr) { console.error(`${logPrefix} race update error:`, rErr.message); return { id: re.id, action: 'error', error: rErr.message }; }
        return { id: re.id, action: 'updated' };
      }
    }
    console.error(`${logPrefix} insert error:`, insErr.message);
    return { id: null, action: 'error', error: insErr.message };
  }
  // Deterministic id retrieval after successful insert
  const created = await findPaymentByProviderUid(supabase, provider, uid);
  console.log(`${logPrefix} created new payment:`, created?.id);
  return { id: created?.id || null, action: 'created' };
}

// Send order to GetCourse
// Now uses getcourse_offer_id from tariffs table instead of hardcoded mapping
interface GetCourseUserData {
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

// Extract bePaid description from webhook payload (P-DESC.1)
function extractBepaidDescription(body: any): string | null {
  const planTitle = body?.plan?.title;
  const planDesc = body?.plan?.description;
  const txDesc =
    body?.transaction?.description ||
    body?.payment?.description ||
    body?.last_transaction?.description ||
    body?.transaction?.payment?.description ||
    null;
  const v = planTitle || planDesc || txDesc;
  return typeof v === 'string' && v.trim().length ? v.trim() : null;
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

interface AmoCRMCreds {
  token: string;
  subdomain: string;
  source: 'integration_instances' | 'env';
}

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

/**
 * Get amoCRM credentials from integration_instances (priority) or env (fallback).
 * Returns null if neither is configured.
 */
async function getAmoCRMCreds(supabase: any): Promise<AmoCRMCreds | null> {
  // Priority 1: integration_instances
  try {
    const { data: instance } = await supabase
      .from('integration_instances')
      .select('config, status')
      .eq('provider', 'amocrm')
      .in('status', ['active', 'connected'])
      .maybeSingle();

    if (instance?.config) {
      const config = instance.config as Record<string, unknown>;
      const token = (config.long_term_token || config.access_token) as string | undefined;
      const subdomainRaw = config.subdomain as string | undefined;
      const subdomain = subdomainRaw ? normalizeAmoCRMSubdomain(subdomainRaw) : null;

      if (token && subdomain) {
        console.log('[AmoCRM-Creds] Loaded from integration_instances, subdomain=' + subdomain);
        return { token, subdomain, source: 'integration_instances' };
      }
    }
  } catch (err) {
    console.error('[AmoCRM-Creds] Error reading integration_instances:', err);
  }

  // Priority 2: env fallback
  const envToken = Deno.env.get('AMOCRM_ACCESS_TOKEN');
  const envSubdomainRaw = Deno.env.get('AMOCRM_SUBDOMAIN');
  const envSubdomain = envSubdomainRaw ? normalizeAmoCRMSubdomain(envSubdomainRaw) : null;

  if (envToken && envSubdomain) {
    console.log('[AmoCRM-Creds] Loaded from env (fallback), subdomain=' + envSubdomain);
    return { token: envToken, subdomain: envSubdomain, source: 'env' };
  }

  console.warn('[AmoCRM-Creds] No credentials found in integration_instances or env');
  return null;
}

async function createAmoCRMContact(
  supabase: any,
  creds: AmoCRMCreds,
  name: string,
  email: string,
  phone?: string
): Promise<number | null> {
  try {
    // First search for existing contact
    const searchResponse = await fetch(
      `https://${creds.subdomain}.amocrm.ru/api/v4/contacts?query=${encodeURIComponent(email)}`,
      {
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData._embedded?.contacts?.length > 0) {
        const existingId = searchData._embedded.contacts[0].id;
        console.log('AmoCRM contact already exists:', existingId);
        await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_label: 'bepaid-webhook',
          action: 'amocrm.contact.found_existing',
          meta: { contact_id: existingId, email, creds_source: creds.source },
        });
        return existingId;
      }
    }

    // Create new contact
    const contact: any = {
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
      `https://${creds.subdomain}.amocrm.ru/api/v4/contacts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([contact]),
      }
    );

    if (createResponse.ok) {
      const data = await createResponse.json();
      const contactId = data._embedded?.contacts?.[0]?.id;
      console.log('AmoCRM contact created:', contactId);
      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'amocrm.contact.upsert.ok',
        meta: { contact_id: contactId, email, creds_source: creds.source },
      });
      return contactId;
    } else {
      const errText = await createResponse.text();
      console.error('Failed to create AmoCRM contact:', createResponse.status, errText.substring(0, 200));
      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'amocrm.contact.upsert.error',
        meta: { http_status: createResponse.status, error_short: errText.substring(0, 120), email, creds_source: creds.source },
      });
    }
  } catch (error) {
    console.error('AmoCRM contact creation error:', error);
    await supabase.from('audit_logs').insert({
      actor_type: 'system', actor_label: 'bepaid-webhook',
      action: 'amocrm.contact.upsert.error',
      meta: { error_short: String(error).substring(0, 120), email, creds_source: creds.source },
    });
  }

  return null;
}

async function createAmoCRMDeal(
  supabase: any,
  creds: AmoCRMCreds,
  name: string,
  price: number,
  contactId?: number | null,
  meta?: Record<string, any>
): Promise<number | null> {
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
      `https://${creds.subdomain}.amocrm.ru/api/v4/leads`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([deal]),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const dealId = data._embedded?.leads?.[0]?.id;
      console.log('AmoCRM deal created:', dealId);
      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'amocrm.deal.upsert.ok',
        meta: { deal_id: dealId, contact_id: contactId, price, creds_source: creds.source },
      });
      return dealId;
    } else {
      const errText = await response.text();
      console.error('Failed to create AmoCRM deal:', response.status, errText.substring(0, 200));
      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'amocrm.deal.upsert.error',
        meta: { http_status: response.status, error_short: errText.substring(0, 120), contact_id: contactId, creds_source: creds.source },
      });
    }
  } catch (error) {
    console.error('AmoCRM deal creation error:', error);
    await supabase.from('audit_logs').insert({
      actor_type: 'system', actor_label: 'bepaid-webhook',
      action: 'amocrm.deal.upsert.error',
      meta: { error_short: String(error).substring(0, 120), contact_id: contactId, creds_source: creds.source },
    });
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

// PATCH-1.1: Normalize public_key from integration_instances to proper PEM format
// Handles keys stored without headers/footers or without line breaks
function normalizePemPublicKey(rawKey: string | null | undefined): string | null {
  if (!rawKey) return null;

  let key = rawKey.trim();

  // Remove existing PEM headers/footers if present
  key = key
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/[\r\n\s]/g, ''); // Remove all whitespace

  if (key.length === 0) return null;

  // Split base64 into 64-character lines (PEM standard)
  const lines: string[] = [];
  for (let i = 0; i < key.length; i += 64) {
    lines.push(key.substring(i, i + 64));
  }

  // Reconstruct proper PEM format
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

// PATCH-1.3: Verify webhook signature using RSA-SHA256 (bePaid official method)
// NO FALLBACK to hardcoded key - ONLY uses provided publicKeyPem
async function verifyWebhookSignature(
  body: string,
  signature: string | null,
  publicKeyPem: string
): Promise<boolean> {
  if (!signature) {
    console.log('[SIGNATURE] Missing Content-Signature header');
    return false;
  }
  
  // publicKeyPem is already normalized by caller - no fallback allowed
  
  try {
    // Decode base64 signature
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    
    // Parse PEM to get raw key bytes
    const pemHeader = '-----BEGIN PUBLIC KEY-----';
    const pemFooter = '-----END PUBLIC KEY-----';
    const pemContents = publicKeyPem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
    const keyBytes = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Import public key for RSA-SHA256 verification
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Verify signature against RAW body
    const encoder = new TextEncoder();
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      encoder.encode(body)
    );
    
    console.log('[SIGNATURE] RSA-SHA256 verification result:', isValid);
    return isValid;
  } catch (error) {
    console.error('[SIGNATURE] RSA verification error:', error);
    return false;
  }
}

// =====================================================================
// PATCH P2: Centralized parseTrackingId
// =====================================================================
type TrackingParse = {
  kind: 'subv2' | 'link_order' | 'link' | 'uuid' | 'uuid_pair' | 'unknown';
  orderId: string | null;
  offerId: string | null;
  subscriptionV2Id: string | null;
  raw: string | null;
};

function parseTrackingId(raw: string | null): TrackingParse {
  if (!raw) return { kind: 'unknown', orderId: null, offerId: null, subscriptionV2Id: null, raw };

  // subv2:{subscription_v2_id}:order:{order_id}
  const subv2Match = raw.match(/^subv2:([^:]+):order:(.+)$/i);
  if (subv2Match) {
    return { kind: 'subv2', orderId: subv2Match[2], offerId: null, subscriptionV2Id: subv2Match[1], raw };
  }
  // A4: Support legacy subv2:{uuid} format (without :order:)
  const simpleSubv2 = raw.match(/^subv2:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (simpleSubv2) {
    return { kind: 'subv2', orderId: null, offerId: null, subscriptionV2Id: simpleSubv2[1], raw };
  }
  if (raw.startsWith('subv2:')) {
    return { kind: 'subv2', orderId: null, offerId: null, subscriptionV2Id: null, raw };
  }

  const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
  const linkOrder = new RegExp(`^link:order:${uuid}(?:$|:)`, 'i');
  const link = new RegExp(`^link:${uuid}(?:$|:)`, 'i');

  const m1 = raw.match(linkOrder);
  if (m1) return { kind: 'link_order', orderId: m1[1], offerId: null, subscriptionV2Id: null, raw };

  const m2 = raw.match(link);
  if (m2) return { kind: 'link', orderId: m2[1], offerId: null, subscriptionV2Id: null, raw };

  // uuid or uuid_uuid
  const uuidRe = new RegExp(`^${uuid}$`, 'i');
  const parts = raw.split('_');
  if (parts.length >= 1 && uuidRe.test(parts[0])) {
    const orderId = parts[0];
    const offerId = (parts.length >= 2 && uuidRe.test(parts[1])) ? parts[1] : null;
    return { kind: offerId ? 'uuid_pair' : 'uuid', orderId, offerId, subscriptionV2Id: null, raw };
  }

  return { kind: 'unknown', orderId: null, offerId: null, subscriptionV2Id: null, raw };
}

// =====================================================================
// PATCH P2: Best-effort recordWebhookEvent (never breaks main flow)
// =====================================================================
async function recordWebhookEvent(
  supabase: any,
  data: {
    provider: string;
    event_type?: string | null;
    transaction_uid?: string | null;
    subscription_id?: string | null;
    tracking_id?: string | null;
    parsed_kind?: string | null;
    parsed_order_id?: string | null;
    outcome: string;
    http_status?: number | null;
    processing_ms?: number | null;
    error_message?: string | null;
    body_hash?: string | null;
    handler_result?: string | null;
    queue_write_ok?: boolean | null;
    queue_row_id?: string | null;
  }
): Promise<void> {
  try {
    // P3.0.5: Append tracing data to error_message ONLY for non-processed outcomes
    let finalErrorMessage = data.error_message?.substring(0, 500) || null;
    const isNonProcessed = data.outcome !== 'processed' && data.outcome !== 'already_processed'
      && data.outcome !== 'skipped_not_successful' && data.outcome !== 'ignored_provider_events';

    if (isNonProcessed && (data.body_hash || data.handler_result || data.queue_row_id)) {
      const trace = JSON.stringify({
        body_hash: data.body_hash || null,
        handler_result: data.handler_result || null,
        queue_write_ok: data.queue_write_ok ?? null,
        queue_row_id: data.queue_row_id || null,
      });
      const traceStr = ` | TRACE: ${trace}`;
      // Guard against overly long error_message (max ~4KB)
      const base = finalErrorMessage || '';
      if (base.length + traceStr.length < 4000) {
        finalErrorMessage = base + traceStr;
      }
    }

    await supabase.from('webhook_events').insert({
      provider: data.provider,
      event_type: data.event_type || null,
      transaction_uid: data.transaction_uid || null,
      subscription_id: data.subscription_id || null,
      tracking_id: data.tracking_id || null,
      parsed_kind: data.parsed_kind || null,
      parsed_order_id: data.parsed_order_id || null,
      outcome: data.outcome,
      http_status: data.http_status || null,
      processing_ms: data.processing_ms || null,
      error_message: finalErrorMessage,
    });
  } catch (err) {
    console.error('[WEBHOOK-EVENT] Best-effort write failed:', err);
  }
}

// maskEmail is now imported from _shared/admin-notify-message.ts

// Helper to create safe subset of webhook body for orphans (NO PII/card data)
function createSafeOrphanData(body: any, trackingId: string | null): Record<string, any> {
  return {
    id: body?.id,
    state: body?.state,
    event: body?.event,
    tracking_id: trackingId || body?.tracking_id,
    last_transaction: body?.last_transaction ? {
      uid: body.last_transaction.uid,
      status: body.last_transaction.status,
    } : (body?.transaction ? {
      uid: body.transaction.uid,
      status: body.transaction.status,
    } : null),
    plan: body?.plan ? {
      id: body.plan.id,
      amount: body.plan.amount,
      currency: body.plan.currency,
    } : null,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let bodyText = '';
  // P3.0.1a: Local trace object — NO globalThis (race-condition safe)
  const trace = { bodyHash: null as string | null, queueWriteOk: false, queueRowId: null as string | null };

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
    // PATCH-P0.9: NO env fallback — strict isolation
    const bepaidWebhookSecret = bepaidInstance?.config?.webhook_secret || bepaidInstance?.config?.secret_key;
    const bepaidSecretKey = bepaidInstance?.config?.secret_key;
    console.log('Using bePaid webhook secret from:', bepaidInstance?.config?.webhook_secret ? 'webhook_secret' : (bepaidInstance?.config?.secret_key ? 'secret_key' : 'env'));

    // Read body as text for signature verification
    bodyText = await req.text();
    
    // Log webhook receipt for audit trail
    console.log(`[WEBHOOK-RECEIVED] Timestamp: ${new Date().toISOString()}, Size: ${bodyText.length} bytes`);

    // P3.0.5: Compute body_hash for tracing/dedup (P3.0.1a: local trace, no globalThis)
    try {
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(bodyText));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      trace.bodyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_hashErr) {
      trace.bodyHash = null;
    }
    
    // Log webhook signature header for debugging
    // bePaid uses Content-Signature header (primary), fallback to X-Signature or X-Webhook-Signature
    const signatureHeader = req.headers.get('Content-Signature') || 
                            req.headers.get('X-Signature') ||
                            req.headers.get('X-Webhook-Signature') || 
                            req.headers.get('Authorization')?.replace('Bearer ', '') || null;
    console.log('Webhook signature header:', signatureHeader ? 'present' : 'missing', 
      'Headers checked: Content-Signature, X-Signature, X-Webhook-Signature');
    
    // SIGNATURE VERIFICATION - STRICT MODE (NO FALLBACK)
    // Per security policy: If signature verification fails → 401 + orphan only
    // NO changes to payments/orders/subscriptions/provider_subscriptions
    
    let signatureVerified = false;
    let signatureSkipReason: string | null = null;
    
    // Parse body early
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      console.error('[WEBHOOK-ERROR] Failed to parse webhook body');
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: corsHeaders }
      );
    }
    
    // Extract tracking_id for logging only (NOT for security bypass)
    const rawTrackingIdEarly = body.tracking_id || 
                               body.additional_data?.order_id ||
                               body.transaction?.tracking_id ||
                               body.last_transaction?.tracking_id ||
                               null;
    
    // PATCH-1.0: STRICT SIGNATURE VERIFICATION - NO FALLBACK
    // Order of checks:
    // 1. Try BasicAuth (Authorization: Basic shop_id:secret_key)
    // 2. Try RSA signature (Content-Signature + public_key)
    // 3. If neither works → 401/500 + orphan (safe subset)
    
    const authHeader = req.headers.get('Authorization');
    
    // PATCH-1.4/1.5: Check for misconfig FIRST
    const rawPublicKey = bepaidInstance?.config?.public_key;
    const normalizedPublicKey = normalizePemPublicKey(rawPublicKey);
    // PATCH-P0.9: NO env fallback — strict isolation
    const secretKey = bepaidInstance?.config?.secret_key;
    const shopId = bepaidInstance?.config?.shop_id;
    
    // If no auth method available at all → 500 misconfig
    if (!normalizedPublicKey && !secretKey) {
      console.error('[WEBHOOK-CRITICAL] No public_key AND no secret_key - cannot verify webhook');
      
      await supabase.from('provider_webhook_orphans').upsert({
        provider: 'bepaid',
        provider_subscription_id: body?.id || body?.subscription?.id || null,
        provider_payment_id: body?.transaction?.uid || body?.last_transaction?.uid || null,
        reason: 'missing_credentials',
        raw_data: createSafeOrphanData(body, rawTrackingIdEarly),
        processed: false,
      }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
      
      // Alert admins
      try {
        await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({
            message: '🚨 КРИТИЧНО: Webhook bePaid отклонён — нет public_key и нет secret_key в конфигурации!',
            source: 'bepaid-webhook-misconfig',
          }),
        });
      } catch (_) {}
      
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration: missing credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Try BasicAuth first (Authorization: Basic base64(shop_id:secret_key))
    if (authHeader?.startsWith('Basic ') && secretKey && shopId) {
      try {
        const base64Creds = authHeader.replace('Basic ', '');
        const decoded = atob(base64Creds);
        const [providedShopId, providedSecret] = decoded.split(':');
        
        if (providedShopId === String(shopId) && providedSecret === secretKey) {
          signatureVerified = true;
          console.log('[WEBHOOK-OK] BasicAuth verified successfully');
        } else {
          console.warn('[WEBHOOK-SECURITY] BasicAuth credentials mismatch');
        }
      } catch (e) {
        console.warn('[WEBHOOK-SECURITY] Failed to decode BasicAuth:', e);
      }
    }
    
    // If BasicAuth didn't work, try RSA signature
    if (!signatureVerified && signatureHeader) {
      if (!normalizedPublicKey) {
        // Have signature but no public_key to verify → 500 misconfig
        console.error('[WEBHOOK-CRITICAL] Have Content-Signature but no public_key to verify');
        
        await supabase.from('provider_webhook_orphans').upsert({
          provider: 'bepaid',
          provider_subscription_id: body?.id || body?.subscription?.id || null,
          provider_payment_id: body?.transaction?.uid || body?.last_transaction?.uid || null,
          reason: 'missing_public_key',
          raw_data: createSafeOrphanData(body, rawTrackingIdEarly),
          processed: false,
        }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
        
        // Alert admins
        try {
          await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify({
              message: '🚨 КРИТИЧНО: Webhook bePaid отклонён — есть Content-Signature, но отсутствует public_key!',
              source: 'bepaid-webhook-misconfig',
            }),
          });
        } catch (_) {}
        
        return new Response(
          JSON.stringify({ error: 'Server misconfiguration: missing public_key' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Verify RSA signature using RAW body and normalized public key
      signatureVerified = await verifyWebhookSignature(bodyText, signatureHeader, normalizedPublicKey);
      
      if (signatureVerified) {
        console.log('[WEBHOOK-OK] RSA signature verified successfully');
      } else {
        signatureSkipReason = 'invalid_signature';
        console.error('[WEBHOOK-SECURITY] RSA signature verification FAILED');
      }
    }
    
    // If no signature header and BasicAuth also failed → check if we even have a way to verify
    if (!signatureVerified && !signatureHeader && !authHeader?.startsWith('Basic ')) {
      signatureSkipReason = 'no_auth_method';
      console.error('[WEBHOOK-SECURITY] No Content-Signature and no BasicAuth provided');
    }
    
    console.log(`[WEBHOOK-SIGNATURE] verified=${signatureVerified}, reason=${signatureSkipReason}`);
    
    // P3.0.1c: Secure replay bypass — dedicated secret + explicit replay markers + env guard
    const internalKey = req.headers.get('x-internal-key');
    const expectedInternalKey = Deno.env.get('BEPAID_WEBHOOK_INTERNAL_SECRET');
    const isReplay = req.headers.get('x-replay') === '1';
    const requestedReplayMode = (req.headers.get('x-replay-mode') || 'trace_only') as 'trace_only' | 'full';

    // Environment guards
    const replayEnabled = Deno.env.get('BEPAID_WEBHOOK_REPLAY_ENABLED') === '1';
    const replayFullEnabled = Deno.env.get('BEPAID_WEBHOOK_REPLAY_FULL_ENABLED') === '1';

    // Bypass only if: secret exists + matches + explicit replay marker + env allows
    const bypassSignature =
      !!internalKey &&
      !!expectedInternalKey &&
      internalKey === expectedInternalKey &&
      isReplay &&
      replayEnabled;

    // Force trace_only unless FULL is explicitly enabled
    let replayMode: 'trace_only' | 'full' = requestedReplayMode;
    if (replayMode === 'full' && !replayFullEnabled) {
      replayMode = 'trace_only';
      console.warn('[WEBHOOK-REPLAY] full mode blocked, downgraded to trace_only');
    }

    if (!signatureVerified && bypassSignature) {
      signatureVerified = true;
      signatureSkipReason = null;
      console.log(`[WEBHOOK-OK] Replay bypass verified (mode=${replayMode})`);
    }

    // Queue source marker for replay traceability
    const queueSource = bypassSignature ? 'webhook_replay' : 'webhook';

    // PATCH-1.7: STRICT - If signature not verified → 401 + orphan (safe subset)
    if (!signatureVerified) {
      console.error('[WEBHOOK-REJECT] Invalid/missing signature - saving to orphans only');
      
      // Save to provider_webhook_orphans with SAFE SUBSET (no PII)
      await supabase.from('provider_webhook_orphans').upsert({
        provider: 'bepaid',
        provider_subscription_id: body?.id || body?.subscription?.id || null,
        provider_payment_id: body?.transaction?.uid || body?.last_transaction?.uid || null,
        reason: signatureSkipReason || 'invalid_signature',
        raw_data: createSafeOrphanData(body, rawTrackingIdEarly),
        processed: false,
      }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
      
      // Audit log for security tracking
      await supabase.from('audit_logs').insert({
        actor_user_id: null,
        actor_type: 'system',
        actor_label: 'bepaid-webhook-security',
        action: 'webhook.rejected_invalid_signature',
        meta: { 
          reason: signatureSkipReason, 
          tracking_id: rawTrackingIdEarly,
          transaction_uid: body?.transaction?.uid || body?.last_transaction?.uid,
        },
      });
      
      return new Response(
        JSON.stringify({ error: 'Invalid signature', reason: signatureSkipReason }),
        { status: 401, headers: corsHeaders }
      );
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
    // P3.0.1: Destructure {data, error} and log always
    if (webhookTransaction.uid) {
      try {
        const errorMsg = webhookTxStatus !== 'successful' ? (webhookTransaction.message || `Status: ${webhookTxStatus}`) : null;
        const errorCategory = errorMsg ? normalizeErrorCategory(errorMsg, webhookTransaction.decline_code) : null;
        
        // P3.0.1d: Manual idempotency (SELECT→INSERT) to avoid 42P10 with partial unique index
        const { data: existingRow } = await supabase
          .from('payment_reconcile_queue')
          .select('id, source, bepaid_uid')
          .eq('bepaid_uid', webhookTransaction.uid)
          .maybeSingle();

        let queueRow: any = null;
        let queueError: any = null;

        if (existingRow) {
          // Duplicate — reuse existing row
          queueRow = existingRow;
          console.log(`[WEBHOOK-QUEUE] DUPLICATE existing id=${existingRow.id} uid=${existingRow.bepaid_uid}`);
        } else {
          // Insert new row (NOT upsert — avoids 42P10)
          const { data, error } = await supabase.from('payment_reconcile_queue').insert({
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
            raw_payload: {
              ...(body ?? {}),
              _trace: {
                replay: bypassSignature,
                replay_mode: bypassSignature ? replayMode : null,
                body_hash: trace.bodyHash ?? null,
                handler: 'bepaid-webhook',
                queued_at: new Date().toISOString(),
              },
            },
            source: queueSource,
            status: webhookTxStatus === 'successful' ? 'pending' : 'error',
            status_normalized: webhookNormalizedStatus,
            transaction_type: isWebhookRefund ? 'Возврат средств' : 'Оплата',
            paid_at: webhookTransaction.paid_at || webhookTransaction.created_at || new Date().toISOString(),
            reference_transaction_uid: webhookReferenceUid,
            last_error: errorMsg,
            error_category: errorCategory,
            three_d_secure: webhookTransaction.three_d_secure_verification?.status === 'successful',
          })
            .select('id, source, bepaid_uid, created_at')
            .maybeSingle();
          queueRow = data;
          queueError = error;
        }

        if (queueError) {
          console.error('[WEBHOOK-QUEUE] DB error:', JSON.stringify({
            code: queueError.code,
            message: queueError.message,
            details: queueError.details,
            hint: queueError.hint,
            bepaid_uid: webhookTransaction.uid,
            source: 'webhook',
          }));
        } else if (!queueRow) {
          console.error('[WEBHOOK-QUEUE] No row returned (silent rejection):', JSON.stringify({
            bepaid_uid: webhookTransaction.uid,
            tracking_id: rawTrackingIdEarly,
            source: 'webhook',
          }));
        } else {
          console.log(`[WEBHOOK-QUEUE] OK id=${queueRow.id} source=${queueRow.source} uid=${queueRow.bepaid_uid}`);
        }
        // P3.0.1d: Store in local trace
        trace.queueWriteOk = !queueError && !!queueRow;
        trace.queueRowId = queueRow?.id || null;
      } catch (queueErr) {
        console.error('[WEBHOOK-QUEUE] JS exception saving to queue:', queueErr);
        trace.queueWriteOk = false;
        trace.queueRowId = null;
        // Continue processing even if queue save fails
      }
    }

    // P3.0.1c: trace_only mode — NO side effects beyond webhook_events + queue
    if (bypassSignature && replayMode === 'trace_only') {
      const earlyEventType = body?.event || body?.type || null;
      const earlyTxUid = body?.transaction?.uid || body?.last_transaction?.uid || null;
      const earlySubId = body?.id || body?.subscription?.id || null;

      await recordWebhookEvent(supabase, {
        provider: 'bepaid',
        event_type: earlyEventType,
        transaction_uid: earlyTxUid,
        subscription_id: earlySubId ? String(earlySubId) : null,
        tracking_id: rawTrackingIdEarly,
        parsed_kind: null,
        parsed_order_id: null,
        outcome: 'replay_trace_only',
        http_status: 200,
        processing_ms: Date.now() - startTime,
        error_message: null,
        body_hash: trace.bodyHash,
        handler_result: JSON.stringify({ mode: 'trace_only', queue_source: queueSource }),
        queue_write_ok: trace.queueWriteOk,
        queue_row_id: trace.queueRowId,
      });

      return new Response(JSON.stringify({
        ok: true,
        outcome: 'replay_trace_only',
        replay_mode: 'trace_only',
        body_hash: trace.bodyHash,
        queue_write_ok: trace.queueWriteOk,
        queue_row_id: trace.queueRowId,
        queue_source: queueSource,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


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

    // PATCH P2: Use centralized parseTrackingId
    const tracking = parseTrackingId(rawTrackingId);
    const parsedOrderId = tracking.orderId;
    const parsedOfferId = tracking.offerId;
    
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

    // B2: CRITICAL ALERT moved AFTER transactionUid/subscriptionId are defined
    if (rawTrackingId && !parsedOrderId && !rawTrackingId.startsWith('subv2:')) {
      console.error(`[WEBHOOK] CRITICAL: Unrecognized tracking_id format: ${rawTrackingId}`);
      try {
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          action: 'bepaid.webhook.unrecognized_tracking_id',
          meta: {
            tracking_id: rawTrackingId,
            transaction_uid: transactionUid,
            subscription_id: subscriptionId,
            severity: 'CRITICAL',
          },
        });
        await supabase.from('provider_webhook_orphans').upsert({
          provider: 'bepaid',
          provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
          provider_payment_id: transactionUid,
          reason: 'unrecognized_tracking_id',
          raw_data: createSafeOrphanData(body, rawTrackingId),
          processed: false,
        }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
      } catch (orphanErr) {
        console.error('[WEBHOOK] Best-effort orphan/audit write failed:', orphanErr);
      }
    }
    console.log(`Processing bePaid webhook: tracking=${rawTrackingId}, orderId=${orderId}, offerId=${parsedOfferId}, transaction=${transactionUid}, status=${transactionStatus}, subscription=${subscriptionId}, state=${subscriptionState}, isRefund=${isRefundTransaction}`);

    // =====================================================================
    // GUARD: ignore_provider_events — early exit for provider subscriptions marked to be ignored
    // =====================================================================
    if (subscriptionId) {
      const { data: provSub } = await supabase
        .from('provider_subscriptions')
        .select('id, meta')
        .eq('provider_subscription_id', String(subscriptionId))
        .maybeSingle();

      const ignoreMeta = provSub?.meta as Record<string, unknown> | null;
      if (ignoreMeta?.ignore_provider_events === true || ignoreMeta?.ignore === true) {
        console.warn(`[WEBHOOK] IGNORED: provider_subscription ${subscriptionId} has ignore_provider_events flag`);
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: 'webhook.ignored_provider_events',
          meta: {
            provider_subscription_id: subscriptionId,
            bepaid_uid: transactionUid,
            tracking_id: rawTrackingId,
            amount: transaction?.amount,
          },
        });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: body?.event || body?.type || null,
          transaction_uid: transactionUid, subscription_id: subscriptionId ? String(subscriptionId) : null,
          tracking_id: rawTrackingId, parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'ignored_provider_events', http_status: 200,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ received: true, ignored: true, reason: 'ignore_provider_events' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // =====================================================================
    // PATCH-1: PROVIDER-MANAGED SUBSCRIPTION WEBHOOK HANDLER
    // Handle subscription webhooks with tracking_id format: subv2:{subscription_v2_id}:order:{order_id}
    // =====================================================================
    if (isSubscriptionWebhook && rawTrackingId?.startsWith('subv2:')) {
      console.log('[WEBHOOK-SUBSCRIPTION] Processing provider-managed subscription webhook');
      
      // Parse tracking_id: subv2:{subscription_v2_id}:order:{order_id}
      const trackingParts = rawTrackingId.match(/^subv2:([^:]+):order:(.+)$/);
      
      let subscriptionV2Id: string;
      let orderV2Id: string;

      if (trackingParts) {
        subscriptionV2Id = trackingParts[1];
        orderV2Id = trackingParts[2];
      } else {
        // A4: Try legacy subv2:{uuid} format (without :order:)
        const simpleSubv2 = rawTrackingId.match(/^subv2:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (simpleSubv2) {
          subscriptionV2Id = simpleSubv2[1];
          console.log('[WEBHOOK-SUBSCRIPTION] Legacy subv2:{uuid} format, looking up order_id from subscriptions_v2');
          const { data: subRow } = await supabase
            .from('subscriptions_v2')
            .select('id, order_id')
            .eq('id', subscriptionV2Id)
            .maybeSingle();

          if (subRow?.order_id) {
            orderV2Id = String(subRow.order_id);
            console.log('[WEBHOOK-SUBSCRIPTION] Recovered order_id from subscriptions_v2:', orderV2Id);
          } else {
            console.error('[WEBHOOK-SUBSCRIPTION] Legacy subv2:{uuid} — no order_id found in subscriptions_v2');
            await supabase.from('provider_webhook_orphans').upsert({
              provider: 'bepaid',
              provider_subscription_id: subscriptionId,
              provider_payment_id: transactionUid,
              reason: 'subv2_missing_order_id',
              raw_data: createSafeOrphanData(body, rawTrackingId),
              processed: false,
            }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
            // P3.0.2: Enqueue orphan for recovery + return 202 (not 500)
            try {
              const { data: orphanQueueRow, error: orphanQueueErr } = await supabase
                .from('payment_reconcile_queue')
                .insert({
                  bepaid_uid: transactionUid || null,
                  tracking_id: rawTrackingId || null,
                  amount: transaction?.amount ? transaction.amount / 100 : null,
                  currency: transaction?.currency || body.plan?.currency || 'BYN',
                  customer_email: transaction?.customer?.email || null,
                  raw_payload: { ...body, _trace: { body_hash: trace.bodyHash, outcome: 'orphan_subv2_missing_order_id', tracking_id: rawTrackingId } },
                  source: 'webhook_orphan',
                  status: 'error',
                  last_error: 'orphan_subv2_missing_order_id',
                })
                .select('id')
                .maybeSingle();
              if (orphanQueueErr) {
                console.error('[WEBHOOK-ORPHAN-QUEUE] DB error:', JSON.stringify({ code: orphanQueueErr.code, message: orphanQueueErr.message }));
              } else if (!orphanQueueRow) {
                console.error('[WEBHOOK-ORPHAN-QUEUE] No row returned (silent rejection):', { bepaid_uid: transactionUid });
              } else {
                console.log('[WEBHOOK-ORPHAN-QUEUE] Enqueued orphan:', orphanQueueRow.id);
                trace.queueWriteOk = true;
                trace.queueRowId = orphanQueueRow.id;
              }
            } catch (oqErr) {
              console.error('[WEBHOOK-ORPHAN-QUEUE] JS exception:', oqErr);
            }
            await recordWebhookEvent(supabase, {
              provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
              subscription_id: subscriptionId ? String(subscriptionId) : null,
              tracking_id: rawTrackingId, parsed_kind: 'subv2', parsed_order_id: null,
              outcome: 'orphan_subv2_missing_order_id', http_status: 202,
              processing_ms: Date.now() - startTime,
              body_hash: trace.bodyHash,
              handler_result: 'orphan_enqueued',
              queue_write_ok: trace.queueWriteOk,
              queue_row_id: trace.queueRowId,
            });
            return new Response(JSON.stringify({ ok: false, status: 'orphan_subv2_missing_order_id' }), {
              status: 202,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          console.error('[WEBHOOK-SUBSCRIPTION] Bad tracking_id format:', rawTrackingId);
          await supabase.from('provider_webhook_orphans').upsert({
            provider: 'bepaid',
            provider_subscription_id: subscriptionId,
            provider_payment_id: transactionUid,
            reason: 'bad_tracking_id',
            raw_data: createSafeOrphanData(body, rawTrackingId),
            processed: false,
          }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
          await recordWebhookEvent(supabase, {
            provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
            subscription_id: subscriptionId ? String(subscriptionId) : null,
            tracking_id: rawTrackingId, parsed_kind: 'subv2', parsed_order_id: null,
            outcome: 'orphan_bad_tracking_id', http_status: 400,
            processing_ms: Date.now() - startTime,
          });
          return new Response(JSON.stringify({ error: 'Bad tracking_id format' }), {
            status: 400,
            headers: corsHeaders,
          });
        }
      }
      
      console.log('[WEBHOOK-SUBSCRIPTION] Parsed:', { subscriptionV2Id, orderV2Id, subscriptionState, transactionStatus });
      
      // P3.0.7: IDEMPOTENCY CHECK with provider filter + recordWebhookEvent
      if (transactionUid) {
        const { data: existingPayment } = await supabase
          .from('payments_v2')
          .select('id')
          .eq('provider_payment_id', transactionUid)
          .eq('provider', 'bepaid')
          .maybeSingle();
        
        if (existingPayment) {
          console.log('[WEBHOOK-SUBSCRIPTION] Already processed (idempotency):', transactionUid);
          await recordWebhookEvent(supabase, {
            provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
            subscription_id: subscriptionId ? String(subscriptionId) : null,
            tracking_id: rawTrackingId, parsed_kind: 'subv2', parsed_order_id: null,
            outcome: 'duplicate_ignored', http_status: 200,
            processing_ms: Date.now() - startTime,
            body_hash: trace.bodyHash,
            queue_write_ok: trace.queueWriteOk,
            queue_row_id: trace.queueRowId,
          });
          return new Response(JSON.stringify({ ok: true, status: 'duplicate_ignored' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      
      // Get subscription and order data
      const { data: subV2, error: subError } = await supabase
        .from('subscriptions_v2')
        .select('*, tariffs(id, name, access_days, getcourse_offer_id), products_v2(id, name, code, telegram_club_id)')
        .eq('id', subscriptionV2Id)
        .maybeSingle();
      
      if (subError || !subV2) {
        console.error('[WEBHOOK-SUBSCRIPTION] Subscription not found:', subscriptionV2Id);
        await supabase.from('provider_webhook_orphans').upsert({
          provider: 'bepaid',
          provider_subscription_id: subscriptionId,
          provider_payment_id: transactionUid,
          reason: 'subscription_not_found',
          raw_data: createSafeOrphanData(body, rawTrackingId),
          processed: false,
        }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
        return new Response(JSON.stringify({ error: 'Subscription not found' }), {
          status: 404,
          headers: corsHeaders,
        });
      }
      
      const now = new Date();
      
      // Handle based on subscription state
      if (subscriptionState === 'active' && (transaction?.status === 'successful' || !transaction)) {
        console.log('[WEBHOOK-SUBSCRIPTION] Processing ACTIVE subscription');
        
        // Get order data
        const { data: orderV2 } = await supabase
          .from('orders_v2')
          .select('*')
          .eq('id', orderV2Id)
          .maybeSingle();
        
        // ===================================================================
        // PATCH-RB1: REBILL MATERIALIZATION (gated by BEPAID_REBILL_MATERIALIZATION)
        // Cycle >= 2 (repeat charge) → create separate REBILL-order via existing engine.
        // Cycle == 1 (initial activation) → fall through to legacy parent-order update.
        // Modes: off → no-op, dry_run → audit only, on → materialize + repoint payment +
        // canonical grant; legacy branch is short-circuited when proceedLegacy=false.
        // ===================================================================
        const paidCycles = Number(
          (body as any)?.paid_billing_cycles ??
          (subscription as any)?.paid_billing_cycles ??
          0
        );
        const rebillMode = resolveKillSwitchMode(Deno.env.get('BEPAID_REBILL_MATERIALIZATION'));
        let rebillHandled = false;
        if (rebillMode !== 'off' && paidCycles >= 2 && transactionUid && orderV2) {
          try {
            const deps = buildRebillDepsAdapter(supabase);
            const rebillResult = await runRebillFlow(deps, {
              mode: rebillMode,
              parentOrder: {
                id: String(orderV2.id),
                user_id: orderV2.user_id ?? null,
                profile_id: orderV2.profile_id ?? null,
                product_id: orderV2.product_id ?? null,
                tariff_id: orderV2.tariff_id ?? null,
                currency: orderV2.currency ?? 'BYN',
                pipeline_id: orderV2.pipeline_id ?? null,
                pipeline_stage_id: orderV2.pipeline_stage_id ?? null,
                bepaid_subscription_id: subscriptionId ? String(subscriptionId) : null,
                customer_email: orderV2.customer_email ?? null,
                customer_phone: orderV2.customer_phone ?? null,
                payer_type: orderV2.payer_type ?? null,
                meta: (orderV2.meta || {}) as Record<string, unknown>,
              },
              payment: {
                uid: String(transactionUid),
                amount: transaction?.amount
                  ? transaction.amount / 100
                  : (body.plan?.amount ? body.plan.amount / 100 : Number(orderV2.final_price) || 0),
                paid_at: transaction?.paid_at || new Date().toISOString(),
                currency: transaction?.currency || body.plan?.currency || 'BYN',
              },
              subscriptionId: subscriptionId ? String(subscriptionId) : null,
            });
            console.log('[WEBHOOK-SUBSCRIPTION] REBILL flow decision=', rebillResult.decision, 'proceedLegacy=', rebillResult.proceedLegacy, 'mode=', rebillMode);
            if (!rebillResult.proceedLegacy) {
              rebillHandled = true;
              // REBILL handled access. Skip legacy parent-order paid-update + STEP A grant.
              // STEPS C/D/E (provider-sync of subscriptions_v2, provider_subscriptions, payments_v2 enrichment)
              // remain valuable for cohort dashboards — they are non-destructive provider mirrors.
              // We fall through into the existing PATCH H2.1 block but the legacy `grant-access-for-order`
              // STEP A is short-circuited explicitly below via `rebillHandled` guard.
            }
          } catch (rebillErr) {
            // Engine itself threw (adapter-level transport). Audit and fall back to legacy.
            console.error('[WEBHOOK-SUBSCRIPTION] REBILL flow threw, falling back to legacy:', rebillErr);
            try {
              await supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_label: 'bepaid-webhook-rebill',
                action: 'bepaid.rebill.adapter_threw_fallback_legacy',
                meta: {
                  order_id: orderV2Id, subscription_v2_id: subscriptionV2Id,
                  provider_subscription_id: subscriptionId, transaction_uid: transactionUid,
                  paid_billing_cycles: paidCycles, mode: rebillMode,
                  error: String((rebillErr as Error)?.message || rebillErr),
                },
              });
            } catch (_) { /* best-effort */ }
          }
        }

        // 1. Update order status to paid — only when REBILL did NOT handle this charge
        // (initial activation, REBILL off, or REBILL fell back to legacy).
        if (!rebillHandled && orderV2 && orderV2.status !== 'paid') {
          await supabase
            .from('orders_v2')
            .update({
              status: 'paid',
              paid_amount: transaction?.amount ? transaction.amount / 100 : orderV2.final_price,
              meta: {
                ...(orderV2.meta || {}),
                bepaid_subscription_id: subscriptionId,
                bepaid_uid: transactionUid,
                // PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL: ensure payment_flow is set
                ...( !(orderV2.meta as any)?.payment_flow ? { payment_flow: 'bepaid_subscription_renewal' } : {} ),
              },
            })
            .eq('id', orderV2Id);
          console.log('[WEBHOOK-SUBSCRIPTION] Order updated to paid');
        }

        // ===================================================================
        // PATCH H2.1 — CANONICAL-WRITER-ONLY for WEBHOOK-SUBSCRIPTION renewal
        // grant-access-for-order owns:
        //   - subscriptions_v2.access_start_at / access_end_at / status
        //   - entitlements (insert/update/expires_at/status)
        //   - telegram_access (via telegram-grant-access)
        // Webhook does ONLY provider-sync: billing_type, next_charge_at,
        // auto_renew, meta.bepaid_*, provider_subscriptions, payments_v2.
        // On skip/error: audit + NO fallback access writes.
        // ===================================================================

        // Provider-derived diagnostics (used for next_charge_at provider-sync
        // and admin notifications; NOT used to write access dates).
        const accessDays = subV2.tariffs?.access_days || subV2.access_days || 30;
        const bepaidActiveTo = body.active_to || body.subscription?.active_to;
        const bepaidRenewAt = body.renew_at || body.subscription?.renew_at;

        let providerAccessEndDiag: Date;
        if (bepaidActiveTo) {
          providerAccessEndDiag = new Date(endOfDayAppTz(bepaidActiveTo));
        } else {
          providerAccessEndDiag = new Date(now.getTime() + accessDays * 24 * 60 * 60 * 1000);
          console.warn('[WEBHOOK-SUBSCRIPTION] FALLBACK diag: no active_to from bePaid');
          await supabase.from('audit_logs').insert({
            action: 'bepaid.webhook.fallback_access_days_used',
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            target_user_id: subV2.user_id,
            meta: { subscription_id: subscriptionId, access_days: accessDays, reason: 'no_active_to_field' },
          });
        }
        const renewAt = bepaidRenewAt ? new Date(bepaidRenewAt) : providerAccessEndDiag;

        // Finite installment marker (provider-sync only)
        const subV2Meta = (subV2.meta || {}) as Record<string, any>;
        const subInstallmentCount = Number(subV2Meta.installment_count ?? 0);
        const subIsInstallmentFinite =
          subV2Meta.model === 'bepaid_finite_subscription' ||
          (Number.isFinite(subInstallmentCount) && subInstallmentCount >= 2);

        // === STEP A: Canonical writer FIRST (single access write-path) ===
        let grantOutcome: 'ok' | 'skip' | 'error' = 'error';
        let grantStatus = 0;
        let grantResult: any = null;
        if (orderV2Id) {
          try {
            const grantResp = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/grant-access-for-order`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  orderId: orderV2Id,
                  source: 'bepaid_webhook',
                  context: 'subscription_renewal',
                }),
              }
            );
            grantStatus = grantResp.status;
            grantResult = await grantResp.json().catch(() => null);

            if (!grantResp.ok || !grantResult) {
              grantOutcome = 'error';
            } else if (
              grantResult.skipped === true ||
              grantResult.status === 'skipped' ||
              String(grantResult.reason || '').startsWith('skip_') ||
              String(grantResult.reason || '') === 'sbs_mismatch' ||
              String(grantResult.reason || '') === 'manual_review'
            ) {
              grantOutcome = 'skip';
            } else if (grantResult.success === false) {
              grantOutcome = 'error';
            } else {
              grantOutcome = 'ok';
            }
            console.log('[WEBHOOK-SUBSCRIPTION] grant-access outcome:', grantOutcome, grantStatus, grantResult);
          } catch (grantErr) {
            console.error('[WEBHOOK-SUBSCRIPTION] grant-access error:', grantErr);
            grantOutcome = 'error';
          }
        } else {
          console.warn('[WEBHOOK-SUBSCRIPTION] No orderV2Id — cannot invoke canonical writer');
          grantOutcome = 'error';
        }

        // STEP B: skip/error → audit + NO fallback access write. Provider-sync continues.
        if (grantOutcome !== 'ok') {
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            action: 'bepaid.webhook.grant_skipped_no_fallback',
            target_user_id: subV2.user_id,
            meta: {
              branch: 'webhook_subscription_renewal',
              order_id: orderV2Id,
              subscription_v2_id: subscriptionV2Id,
              provider_subscription_id: subscriptionId,
              http_status: grantStatus,
              grant_outcome: grantOutcome,
              grant_result: grantResult,
              severity: grantOutcome === 'error' ? 'CRITICAL' : 'INFO',
            },
          });
        }

        // === STEP C: PROVIDER-SYNC (non-access fields only) ===
        // Fields here are provider facts (billing model, next charge moment, card
        // metadata). They do NOT grant or extend access — that is owned by
        // grant-access-for-order in STEP A.
        await supabase
          .from('subscriptions_v2')
          .update({
            billing_type: 'provider_managed',
            next_charge_at: subIsInstallmentFinite ? null : renewAt.toISOString(),
            auto_renew: !subIsInstallmentFinite,
            meta: {
              ...subV2Meta,
              bepaid_subscription_id: subscriptionId,
              bepaid_activated_at: now.toISOString(),
              ...(subIsInstallmentFinite
                ? {
                    model: 'bepaid_finite_subscription',
                    billing_cycles: Number(subV2Meta.billing_cycles ?? subInstallmentCount),
                    installment_count: subInstallmentCount,
                  }
                : {}),
            },
            updated_at: now.toISOString(),
          })
          .eq('id', subscriptionV2Id);
        console.log('[WEBHOOK-SUBSCRIPTION] provider-sync (non-access) applied, finite=', subIsInstallmentFinite);

        // STEP D: provider_subscriptions state (provider fact mirror)
        await supabase
          .from('provider_subscriptions')
          .update({
            state: 'active',
            next_charge_at: renewAt.toISOString(),
            card_last4: subscription?.card?.last_4 || body.card?.last_4 || null,
            card_brand: subscription?.card?.brand || body.card?.brand || null,
          })
          .eq('provider_subscription_id', subscriptionId);
        console.log('[WEBHOOK-SUBSCRIPTION] provider_subscriptions updated to active');

        // STEP E: payments_v2 (payment fact, not access)
        const paymentAmount = transaction?.amount ? transaction.amount / 100 : (body.plan?.amount ? body.plan.amount / 100 : 0);
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', subV2.user_id)
          .maybeSingle();

        const subPayResult = await upsertPaymentV2(supabase, {
            order_id: orderV2Id,
            user_id: subV2.user_id,
            profile_id: profile?.id || null,
            amount: paymentAmount,
            currency: body.plan?.currency || 'BYN',
            status: 'succeeded',
            provider: 'bepaid',
            provider_payment_id: transactionUid || subscriptionId,
            card_brand: subscription?.card?.brand || body.card?.brand || null,
            card_last4: subscription?.card?.last_4 || body.card?.last_4 || null,
            paid_at: transaction?.paid_at || now.toISOString(),
            is_recurring: true,
            meta: {
              bepaid_subscription_id: subscriptionId,
              provider_managed: true,
              bepaid_description: extractBepaidDescription(body),
            },
          }, '[WEBHOOK-SUBSCRIPTION]');
        console.log('[WEBHOOK-SUBSCRIPTION] payments_v2', subPayResult.action, subPayResult.id);

        // NOTE (PATCH H2.1): entitlements insert/update and prior secondary
        // grant-access invoke removed. The single STEP A invocation above
        // covers both primary (subscription/entitlement) and secondary
        // (access_rules / bonuses / telegram) grants. Webhook never writes
        // entitlements directly anymore.
        
        // 6. Send notifications
        try {
          // Full admin notification (same detail level as regular checkout)
          const { data: customerProfile } = await supabase
            .from('profiles')
            .select('full_name, email, telegram_username')
            .eq('user_id', subV2.user_id)
            .maybeSingle();

          const notifyMessage = buildAdminNotifyMessage({
            operation_type: 'bepaid_subscription_payment',
            client_name: customerProfile?.full_name,
            email: customerProfile?.email,
            telegram_username: customerProfile?.telegram_username,
            product_name: subV2.products_v2?.name,
            tariff_name: subV2.tariffs?.name,
            amount: paymentAmount,
            currency: 'BYN',
            next_charge_at: renewAt.toISOString(),
            source_label: 'Подписка bePaid (автосписание)',
          });
            
          const notifyResp = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-notify-admins`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                message: notifyMessage,
                source: 'bepaid_subscription_webhook',
                order_id: orderV2Id,
              }),
            }
          );
          console.log('[WEBHOOK-SUBSCRIPTION] Full admin notification sent, status:', notifyResp.status);
        } catch (notifyErr) {
          console.error('[WEBHOOK-SUBSCRIPTION] Notification error:', notifyErr);
        }
        
       // 6b. GETCOURSE SYNC for provider-managed subscriptions
       const getcourseOfferId = subV2.tariffs?.getcourse_offer_id;
       const paymentEmail = transaction?.customer?.email || body.customer?.email;
       const tariffCode = subV2.tariffs?.code || subV2.tariffs?.name || 'subscription';
       
       if (getcourseOfferId && orderV2) {
         console.log('[WEBHOOK-SUBSCRIPTION] Starting GetCourse sync: offer_id=' + getcourseOfferId);
         
         // Get profile data for GetCourse
         const { data: profileForGC } = await supabase
           .from('profiles')
           .select('email, phone, first_name, last_name, full_name')
           .eq('user_id', subV2.user_id)
           .maybeSingle();
         
         const gcEmail = profileForGC?.email || paymentEmail || orderV2.customer_email;
         
         if (gcEmail) {
           // Parse first/last name from full_name if needed
           let firstName = profileForGC?.first_name;
           let lastName = profileForGC?.last_name;
           if (!firstName && profileForGC?.full_name) {
             const parts = profileForGC.full_name.split(' ');
             firstName = parts[0];
             lastName = parts.slice(1).join(' ');
           }
           
           const gcResult = await sendToGetCourse(
             {
               email: gcEmail,
               phone: profileForGC?.phone || null,
               firstName: firstName || null,
               lastName: lastName || null,
             },
             parseInt(String(getcourseOfferId), 10) || 0,
             orderV2.order_number || `SUB-${subscriptionV2Id.slice(0, 8)}`,
             paymentAmount,
             tariffCode
           );
           
           // Update order meta with GC sync result
           await supabase.from('orders_v2').update({
             meta: {
               ...(orderV2.meta || {}),
               gc_sync_status: gcResult.success ? 'success' : 'failed',
               gc_sync_error: gcResult.error || null,
               gc_order_id: gcResult.gcOrderId || null,
               gc_deal_number: gcResult.gcDealNumber || null,
               gc_synced_at: new Date().toISOString(),
             }
           }).eq('id', orderV2Id);
           
           // Audit log for GC sync
           await supabase.from('audit_logs').insert({
             actor_type: 'system',
             actor_user_id: null,
             actor_label: 'bepaid-webhook',
             action: gcResult.success ? 'gc_sync_success' : 'gc_sync_failed',
             target_user_id: subV2.user_id,
             meta: { 
               order_id: orderV2Id,
               order_number: orderV2.order_number,
               gc_offer_id: getcourseOfferId,
               gc_order_id: gcResult.gcOrderId,
               error: gcResult.error,
               source: 'provider_managed_subscription',
             },
           });
           
           console.log('[WEBHOOK-SUBSCRIPTION] GetCourse sync result:', gcResult.success ? 'OK' : gcResult.error);
         } else {
           console.log('[WEBHOOK-SUBSCRIPTION] GetCourse sync skipped: no email');
           await supabase.from('orders_v2').update({
             meta: { ...(orderV2.meta || {}), gc_sync_status: 'skipped', gc_sync_error: 'No email found' }
           }).eq('id', orderV2Id);
         }
       } else {
         const skipReason = !getcourseOfferId ? 'no_gc_offer' : 'no_order';
         console.log('[WEBHOOK-SUBSCRIPTION] GetCourse sync skipped:', skipReason);
         if (orderV2) {
           await supabase.from('orders_v2').update({
             meta: { 
               ...(orderV2.meta || {}), 
               gc_sync_status: 'skipped', 
               gc_sync_error: skipReason === 'no_gc_offer' 
                 ? `No GetCourse offer ID for tariff: ${subV2.tariffs?.name || 'unknown'}` 
                 : 'Order not found',
             }
           }).eq('id', orderV2Id);
         }
       }
       
        // 7. Audit log (SYSTEM ACTOR PROOF)
        // PATCH INSTALLMENT-PUBLIC-LINK: distinguish finite installment subscription via model marker.
        const installmentCountForAudit = Number(
          (subV2.meta as any)?.installment_count ?? (orderV2?.meta as any)?.installment_count ?? 0
        );
        const isInstallmentFinite = Number.isFinite(installmentCountForAudit) && installmentCountForAudit >= 2;
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: isInstallmentFinite ? 'bepaid.subscription.installment_processed' : 'bepaid.subscription.processed',
          target_user_id: subV2.user_id,
          meta: {
            subscription_v2_id: subscriptionV2Id,
            order_id: orderV2Id,
            provider_subscription_id: subscriptionId,
            event: 'activated',
            state: subscriptionState,
            last_tx_uid: transactionUid,
            ...(isInstallmentFinite
              ? {
                  model: 'bepaid_finite_subscription',
                  billing_cycles: Number((subV2.meta as any)?.billing_cycles ?? installmentCountForAudit),
                  installment_count: installmentCountForAudit,
                  per_payment_amount: transaction?.amount ? transaction.amount / 100 : null,
                  // STAGE L3 GUARD: для finite bePaid installment internal installment_payments НЕ материализуется.
                  internal_installment_skipped: true,
                }
              : {}),
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: true, 
          mode: 'provider_managed_subscription', 
          status: 'activated',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        
      } else if (['canceled', 'expired', 'failed', 'redirecting'].includes(subscriptionState)) {
        console.log(`[WEBHOOK-SUBSCRIPTION] Processing TERMINAL subscription state: ${subscriptionState}`);
        
        // Update provider_subscriptions state to actual state (not hardcoded)
        await supabase
          .from('provider_subscriptions')
          .update({
            state: subscriptionState,
          })
          .eq('provider_subscription_id', subscriptionId);
        
        // Disable auto_renew but DON'T revoke access retroactively
        await supabase
          .from('subscriptions_v2')
          .update({
            auto_renew: false,
            meta: {
              ...(subV2.meta || {}),
              bepaid_terminal_at: now.toISOString(),
              bepaid_terminal_state: subscriptionState,
            },
          })
          .eq('id', subscriptionV2Id);
        
        // Audit log
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: 'billing.inv22.autorenew_disabled_from_provider_state',
          target_user_id: subV2.user_id,
          meta: {
            subscription_v2_id: subscriptionV2Id,
            provider_subscription_id: subscriptionId,
            state: subscriptionState,
            reason: 'terminal_provider_state',
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: true, 
          mode: 'provider_managed_subscription', 
          status: subscriptionState,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Unknown state - log for investigation
      console.warn('[WEBHOOK-SUBSCRIPTION] Unknown subscription state:', subscriptionState);
      await supabase.from('provider_webhook_orphans').upsert({
        provider: 'bepaid',
        provider_subscription_id: subscriptionId,
        provider_payment_id: transactionUid,
        reason: 'unknown_state',
        raw_data: createSafeOrphanData(body, rawTrackingId),
        processed: false,
      }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
      
      return new Response(JSON.stringify({ ok: true, status: 'unknown_state' }), {
        headers: corsHeaders,
      });
    }
    
    // End of PATCH-1 provider-managed subscription handler
    // =====================================================================

    // =====================================================================
    // PATCH-LINK: LINK ORDER SUBSCRIPTION WEBHOOK HANDLER
    // Handle subscription webhooks with tracking_id format: link:order:{UUID}
    // These come from admin-create-payment-link sent via Telegram
    // =====================================================================
    if (isSubscriptionWebhook && tracking.kind === 'link_order' && parsedOrderId) {
      console.log('[WEBHOOK-LINK-ORDER] Processing link:order: subscription webhook');
      console.log('[WEBHOOK-LINK-ORDER] Parsed:', { parsedOrderId, subscriptionId, subscriptionState, transactionStatus, transactionUid });

      // PATCH P2: Require transactionUid for link_order subscription events
      if (!transactionUid) {
        console.error('[WEBHOOK-LINK-ORDER] Missing transactionUid for link:order event');
        await supabase.from('provider_webhook_orphans').upsert({
          provider: 'bepaid',
          provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
          provider_payment_id: null,
          reason: 'link_order_no_transaction_uid',
          raw_data: createSafeOrphanData(body, rawTrackingId),
          processed: false,
        }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
        // P3.0.2: Enqueue orphan for recovery (no uid → use body_hash in raw_payload)
        try {
          const { data: oqRow, error: oqErr } = await supabase
            .from('payment_reconcile_queue')
            .insert({
              bepaid_uid: null,
              tracking_id: rawTrackingId || null,
              amount: transaction?.amount ? transaction.amount / 100 : null,
              currency: transaction?.currency || body.plan?.currency || 'BYN',
              customer_email: transaction?.customer?.email || body.customer?.email || null,
              raw_payload: { ...body, _trace: { body_hash: trace.bodyHash, outcome: 'failed_no_transaction_uid', tracking_id: rawTrackingId, subscription_id: subscriptionId } },
              source: 'webhook_orphan',
              status: 'error',
              last_error: 'failed_no_transaction_uid',
            })
            .select('id')
            .maybeSingle();
          if (oqErr) {
            console.error('[WEBHOOK-ORPHAN-QUEUE] DB error:', JSON.stringify({ code: oqErr.code, message: oqErr.message }));
          } else if (!oqRow) {
            console.error('[WEBHOOK-ORPHAN-QUEUE] No row returned (silent rejection):', { tracking_id: rawTrackingId });
          } else {
            console.log('[WEBHOOK-ORPHAN-QUEUE] Enqueued no-uid orphan:', oqRow.id);
            trace.queueWriteOk = true;
            trace.queueRowId = oqRow.id;
          }
        } catch (oqEx) {
          console.error('[WEBHOOK-ORPHAN-QUEUE] JS exception:', oqEx);
        }
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', tracking_id: rawTrackingId,
          subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'failed_no_transaction_uid', http_status: 202,
          processing_ms: Date.now() - startTime,
          body_hash: trace.bodyHash,
          handler_result: 'orphan_enqueued_no_uid',
          queue_write_ok: trace.queueWriteOk,
          queue_row_id: trace.queueRowId,
        });
        return new Response(JSON.stringify({ ok: false, status: 'failed_no_transaction_uid' }), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 1) IDEMPOTENCY / CONFLICT: check payments_v2 by provider_payment_id
      const { data: existingPayment } = await supabase
        .from('payments_v2')
        .select('id, order_id, origin')
        .eq('provider_payment_id', transactionUid)
        .eq('provider', 'bepaid')
        .maybeSingle();

      if (existingPayment) {
        // True idempotency only if same order
        if (existingPayment.order_id === parsedOrderId) {
          console.log('[WEBHOOK-LINK-ORDER] Already processed (idempotency):', transactionUid);

          // Best-effort: mark queue materialized (avoid stuck pending if previous run partially succeeded)
          try {
            await supabase
              .from('payment_reconcile_queue')
              .update({
                status: 'materialized',
                processed_at: new Date().toISOString(),
                last_error: null,
              })
              .eq('bepaid_uid', transactionUid);
          } catch (_) {}

          await recordWebhookEvent(supabase, {
            provider: 'bepaid',
            event_type: 'payment_link',
            transaction_uid: transactionUid,
            tracking_id: rawTrackingId,
            parsed_kind: 'link_order',
            parsed_order_id: parsedOrderId,
            outcome: 'already_processed',
            http_status: 200,
            processing_ms: Date.now() - startTime,
          });

          return new Response(JSON.stringify({ ok: true, status: 'already_processed' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // CONFLICT: provider_payment_id exists but linked to different order_id
        console.warn('[WEBHOOK-LINK-ORDER] CONFLICT provider_payment_id linked to other order:', {
          transactionUid,
          existing_order_id: existingPayment.order_id,
          tracking_order_id: parsedOrderId,
          origin: (existingPayment as any).origin,
        });

        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: 'payment_link.conflict_provider_payment_id',
          meta: {
            transaction_uid: transactionUid,
            tracking_id: rawTrackingId,
            parsed_kind: 'link_order',
            existing_payment_id: existingPayment.id,
            existing_order_id: existingPayment.order_id,
            tracking_order_id: parsedOrderId,
            origin: (existingPayment as any).origin || null,
          },
        });

        try {
          await supabase
            .from('payment_reconcile_queue')
            .update({
              status: 'pending_needs_mapping',
              last_error: `conflict: provider_payment_id linked to order ${existingPayment.order_id}, tracking wants ${parsedOrderId}`,
              processed_at: null,
            })
            .eq('bepaid_uid', transactionUid);
        } catch (_) {}

        await recordWebhookEvent(supabase, {
          provider: 'bepaid',
          event_type: 'payment_link',
          transaction_uid: transactionUid,
          tracking_id: rawTrackingId,
          parsed_kind: 'link_order',
          parsed_order_id: parsedOrderId,
          outcome: 'conflict_provider_payment_id',
          http_status: 202,
          processing_ms: Date.now() - startTime,
        });

        return new Response(
          JSON.stringify({
            ok: false,
            status: 'conflict',
            reason: 'provider_payment_id_linked_to_different_order',
            existing_order_id: existingPayment.order_id,
            tracking_order_id: parsedOrderId,
          }),
          { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Only process active/successful subscriptions
      const isSuccessful = (subscriptionState === 'active' || transactionStatus === 'successful');
      if (!isSuccessful) {
        console.log('[WEBHOOK-LINK-ORDER] Non-successful state, skipping:', { subscriptionState, transactionStatus });

        // === RECORD FAILED PAYMENT in payments_v2 (link_order) ===
        const loFailedAmount = transaction?.amount ? transaction.amount / 100 : 0;
        const loFailedCurrency = transaction?.currency || body?.plan?.currency || 'BYN';
        const loFailedCardHolder = transaction?.credit_card?.holder || null;
        const loFailedCardLast4 = transaction?.credit_card?.last_4 || null;
        const loFailedCardBrand = transaction?.credit_card?.brand || null;
        const loFailedTxMessage = transaction?.message || transactionStatus || null;
        const loFailedEmail = transaction?.customer?.email || null;
        const loFailedPhone = transaction?.customer?.phone || null;

        const loFailedRow = {
          order_id: parsedOrderId,  // parsedOrderId is always UUID from parseTrackingId regex
          amount: loFailedAmount,
          currency: loFailedCurrency,
          status: 'failed',
          provider: 'bepaid',
          provider_payment_id: transactionUid,
          card_holder: loFailedCardHolder,
          card_last4: loFailedCardLast4,
          card_brand: loFailedCardBrand,
          error_message: loFailedTxMessage,
          origin: 'bepaid',
          meta: {
            payer_name: loFailedCardHolder,
            customer_email: loFailedEmail,
            customer_phone: loFailedPhone,
            bepaid_status: transactionStatus,
            subscription_state: subscriptionState,
            tracking_id: rawTrackingId,
          },
        };

        // Use helper for idempotent upsert
        if (transactionUid) {
          const loFailedResult = await upsertPaymentV2(supabase, loFailedRow, '[WEBHOOK-LINK-ORDER-FAILED]');
          if (loFailedResult.action === 'error') {
            console.error('[WEBHOOK-LINK-ORDER] Failed payment write error (non-fatal):', loFailedResult.error);
          }
        } else {
          console.warn('[WEBHOOK-LINK-ORDER] No transactionUid for failed payment, skipping payments_v2 write');
        }

        // Audit log (error-guarded, SYSTEM ACTOR)
        const { error: auditErr2 } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: 'payment_link_order.failed_recorded',
          created_at: new Date().toISOString(),
          meta: {
            order_id: parsedOrderId,
            transaction_uid: transactionUid,
            bepaid_status: transactionStatus,
            subscription_state: subscriptionState,
            payer_name: loFailedCardHolder,
          },
        });
        if (auditErr2) console.error('[WEBHOOK-LINK-ORDER] Audit error (non-fatal):', auditErr2);

        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'skipped_not_successful', http_status: 200,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: true, status: 'skipped', reason: 'not_successful' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2. Find order in orders_v2
      const { data: linkOrder, error: linkOrderErr } = await supabase
        .from('orders_v2')
        .select('*')
        .eq('id', parsedOrderId)
        .maybeSingle();

      if (linkOrderErr || !linkOrder) {
        console.error('[WEBHOOK-LINK-ORDER] Order not found:', parsedOrderId);
        try {
          await supabase.from('provider_webhook_orphans').upsert({
            provider: 'bepaid',
            provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
            provider_payment_id: transactionUid,
            reason: 'link_order_not_found',
            raw_data: createSafeOrphanData(body, rawTrackingId),
            processed: false,
          }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
          await supabase.from('audit_logs').insert({
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            action: 'bepaid.webhook.link_order_not_found',
            meta: { order_id: parsedOrderId, transaction_uid: transactionUid, tracking_id: rawTrackingId },
          });
        } catch (orphErr) {
          console.error('[WEBHOOK-LINK-ORDER] Best-effort orphan write failed:', orphErr);
        }
        // P3.0.2: Enqueue orphan + return 202 (not 500)
        try {
          const { data: oqRow, error: oqErr } = await supabase
            .from('payment_reconcile_queue')
            .insert({
              bepaid_uid: transactionUid || null,
              tracking_id: rawTrackingId || null,
              amount: transaction?.amount ? transaction.amount / 100 : null,
              currency: transaction?.currency || body.plan?.currency || 'BYN',
              customer_email: transaction?.customer?.email || null,
              raw_payload: { ...body, _trace: { body_hash: trace.bodyHash, outcome: 'orphaned_order_not_found', tracking_id: rawTrackingId, order_id: parsedOrderId } },
              source: 'webhook_orphan',
              status: 'error',
              last_error: 'orphaned_order_not_found',
            })
            .select('id')
            .maybeSingle();
          if (oqErr) {
            console.error('[WEBHOOK-ORPHAN-QUEUE] DB error:', JSON.stringify({ code: oqErr.code, message: oqErr.message }));
          } else if (!oqRow) {
            console.error('[WEBHOOK-ORPHAN-QUEUE] No row returned (silent rejection):', { bepaid_uid: transactionUid });
          } else {
            console.log('[WEBHOOK-ORPHAN-QUEUE] Enqueued orphan order_not_found:', oqRow.id);
            trace.queueWriteOk = true;
            trace.queueRowId = oqRow.id;
          }
        } catch (oqEx) {
          console.error('[WEBHOOK-ORPHAN-QUEUE] JS exception:', oqEx);
        }
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'orphaned_order_not_found', http_status: 202,
          processing_ms: Date.now() - startTime,
          body_hash: trace.bodyHash,
          handler_result: 'orphan_enqueued',
          queue_write_ok: trace.queueWriteOk,
          queue_row_id: trace.queueRowId,
        });
        return new Response(JSON.stringify({ ok: false, status: 'orphaned' }), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. PATCH P2: Amount cascade — plan.amount > transaction.amount > order.final_price
      const paymentAmount = (body.plan?.amount ? body.plan.amount / 100 : 0)
        || (transaction?.amount ? transaction.amount / 100 : 0)
        || Number(linkOrder.final_price) || 0;
      
      // PATCH P2: Amount != 0 guard
      // P3.0.4: Enhanced cascade debug log (keep 500 — this is a mapping error, bePaid should retry)
      if (paymentAmount <= 0) {
        console.error('[WEBHOOK-LINK-ORDER] Amount=0 cascade debug:', JSON.stringify({
          plan_amount: body.plan?.amount,
          tx_amount: transaction?.amount,
          order_final_price: linkOrder.final_price,
          sbs_id: subscriptionId,
          tracking_id: rawTrackingId,
          order_id: parsedOrderId,
        }));
        await supabase.from('provider_webhook_orphans').upsert({
          provider: 'bepaid',
          provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
          provider_payment_id: transactionUid,
          reason: 'link_order_amount_zero',
          raw_data: createSafeOrphanData(body, rawTrackingId),
          processed: false,
        }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'failed_amount_zero', http_status: 500,
          processing_ms: Date.now() - startTime,
          error_message: `Amount cascade resulted in 0: plan=${body.plan?.amount}, tx=${transaction?.amount}, order=${linkOrder.final_price}`,
        });
        return new Response(JSON.stringify({ ok: false, status: 'failed_amount_zero' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const existingMeta = (linkOrder.meta && typeof linkOrder.meta === 'object') ? linkOrder.meta : {};
      // STAGE L3: признак installment-order вычисляется здесь, чтобы guard'ы ниже могли его использовать.
      const installmentCountFromOrderMeta = Number((existingMeta as Record<string, any>).installment_count ?? 0);
      const isInstallmentOrder = Number.isFinite(installmentCountFromOrderMeta) && installmentCountFromOrderMeta >= 2;
      // F12 P1: fill-only provider_payment_id on order
      const orderUpdatePayload: Record<string, any> = {
        status: 'paid',
        paid_amount: paymentAmount,
        meta: { ...existingMeta, bepaid_subscription_id: subscriptionId,
          // PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL
          ...( !existingMeta?.payment_flow ? { payment_flow: 'bepaid_subscription_charge' } : {} ),
        },
        updated_at: new Date().toISOString(),
      };
      // Fill-only: set provider_payment_id only if NULL
      if (!linkOrder.provider_payment_id && transactionUid) {
        orderUpdatePayload.provider_payment_id = transactionUid;
      }
      await supabase
        .from('orders_v2')
        .update(orderUpdatePayload)
        .eq('id', linkOrder.id);
      console.log('[WEBHOOK-LINK-ORDER] Order updated to paid:', linkOrder.id, 'amount:', paymentAmount, 'ppid_filled:', !linkOrder.provider_payment_id && !!transactionUid);

      // CRM routing — Layer A: применить closed_won (subscription init / link-order success)
      try { await applyCrmStageOnTerminal(supabase, linkOrder.id, 'success', 'webhook_link_order_paid'); }
      catch (e) { console.error('[WEBHOOK-LINK-ORDER] crm-routing apply failed:', e); }

      // PATCH-PUBLIC-LINK-COUNTER: idempotently consume payment_links slot for subscription link orders
      try {
        const consumed = await consumePaymentLinkForOrder(supabase, linkOrder.id, 'bepaid-webhook[link-order]');
        console.log('[WEBHOOK-LINK-ORDER] payment_link consume result:', consumed);
      } catch (e) {
        console.error('[WEBHOOK-LINK-ORDER] payment_link consume failed (non-fatal):', e);
      }

      // F12 P7: Audit log for fill operation
      if (!linkOrder.provider_payment_id && transactionUid) {
        await supabase.from('audit_logs').insert({
          actor_user_id: null,
          actor_type: 'system',
          actor_label: 'F12_ord_link',
          action: 'order.fill_provider_payment_id',
          meta: { order_id: linkOrder.id, provider_payment_id: transactionUid, source: 'link_order_webhook' },
        });
      }

      // 4. PATCH P2: payments_v2 UPSERT (idempotent by provider+provider_payment_id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', linkOrder.user_id)
        .maybeSingle();

      // F12.1 P5: Check if payment already exists with order_id set — fill-only guard
      const { data: existingPayForP5 } = await supabase
        .from('payments_v2')
        .select('id, order_id')
        .eq('provider', 'bepaid')
        .eq('provider_payment_id', transactionUid)
        .maybeSingle();

      const p5OrderId = (existingPayForP5?.order_id) ? existingPayForP5.order_id : linkOrder.id;

      const paymentPayload = {
          order_id: p5OrderId,
          user_id: linkOrder.user_id,
          profile_id: profile?.id || linkOrder.profile_id || null,
          amount: paymentAmount,
          currency: transaction?.currency || 'BYN',
          status: 'succeeded',
          provider: 'bepaid',
          provider_payment_id: transactionUid,
          card_brand: subscription?.card?.brand || body.card?.brand || transaction?.credit_card?.brand || null,
          card_last4: subscription?.card?.last_4 || body.card?.last_4 || transaction?.credit_card?.last_4 || null,
          paid_at: transaction?.paid_at || new Date().toISOString(),
          is_recurring: true,
          provider_response: {
            transaction_uid: transactionUid,
            status: transactionStatus,
            amount: transaction?.amount,
            currency: transaction?.currency,
            paid_at: transaction?.paid_at,
            subscription_id: subscriptionId,
          },
          meta: {
            bepaid_subscription_id: subscriptionId,
            source: 'link_order_subscription_webhook',
            bepaid_description: extractBepaidDescription(body),
          },
      };

      // transactionUid guard
      if (!transactionUid) {
        console.error('[WEBHOOK-LINK-ORDER] SKIP payments_v2: no transactionUid');
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', transaction_uid: null,
          tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'skipped_no_uid', http_status: 202,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: false, status: 'skipped_no_uid' }), {
          status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const payUpsertResult = await upsertPaymentV2(supabase, paymentPayload, '[WEBHOOK-LINK-ORDER]');

      if (payUpsertResult.action === 'error') {
        console.error('[WEBHOOK-LINK-ORDER] payments_v2 write FAILED:', payUpsertResult.error);

        // Audit log
        try {
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
            action: 'bepaid.webhook.payments_v2_write_failed',
            created_at: new Date().toISOString(),
            meta: {
              order_id: linkOrder.id, tracking_id: rawTrackingId, transaction_uid: transactionUid,
              error_message: payUpsertResult.error,
            },
          });
        } catch (_) {}

        // Orphan record
        try {
          await supabase.from('provider_webhook_orphans').insert({
            provider: 'bepaid',
            provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
            provider_payment_id: transactionUid,
            reason: 'payments_v2_write_failed',
            raw_data: createSafeOrphanData(body, rawTrackingId),
            processed: false,
          });
        } catch (_) {}

        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
          parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
          outcome: 'failed_payments_v2_write', http_status: 500,
          processing_ms: Date.now() - startTime, error_message: payUpsertResult.error,
        });

        return new Response(
          JSON.stringify({ ok: false, status: 'failed_payments_v2_write', error: payUpsertResult.error }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log('[WEBHOOK-LINK-ORDER] payments_v2', payUpsertResult.action, payUpsertResult.id);


      // 5. PATCH P2: provider_subscriptions UPSERT (not UPDATE)
      if (subscriptionId) {
        // PATCH P2.9: Compute next_charge_at with guard against null overwrite
        const newNextChargeAt = subscription?.next_billing_at || body.next_billing_at || null;

        // PATCH F5: Read existing meta to preserve order_id/checkout_url/tracking_id from create-payment-checkout
        const providerSubscriptionIdStr = String(subscriptionId);
        let existingPsMeta: Record<string, any> = {};
        try {
          const { data: existingPsRow } = await supabase
            .from('provider_subscriptions')
            .select('meta')
            .eq('provider', 'bepaid')
            .eq('provider_subscription_id', providerSubscriptionIdStr)
            .maybeSingle();
          existingPsMeta = (existingPsRow?.meta as Record<string, any>) || {};
        } catch (readErr) {
          console.warn('[WEBHOOK-LINK-ORDER] F5: existing provider_subscription meta read error', readErr);
        }

        const psData: Record<string, any> = {
          provider: 'bepaid',
          provider_subscription_id: providerSubscriptionIdStr,
          state: 'active',
          last_charge_at: new Date().toISOString(),
          card_brand: subscription?.card?.brand || body.card?.brand || null,
          card_last4: subscription?.card?.last_4 || body.card?.last_4 || null,
          updated_at: new Date().toISOString(),
          // PATCH P2.8: Always save raw_data + meta snapshot
          raw_data: body,
          // PATCH F5: Merge meta — preserve order_id/checkout_url/tracking_id from checkout flow
          meta: {
            ...existingPsMeta,
            provider_snapshot: {
              state: subscription?.state || body.state || 'active',
              plan: body.plan || subscription?.plan || null,
              customer: body.customer ? { email: body.customer?.email } : null,
              created_at: subscription?.created_at || body.created_at,
              next_billing_at: subscription?.next_billing_at || body.next_billing_at,
            },
            snapshot_at: new Date().toISOString(),
            cancellation_capability: subscription?.cancellation_capability || null,
          },
        };
        // PATCH P2.9: Only set next_charge_at if we have a value (don't overwrite with null)
        if (newNextChargeAt) {
          psData.next_charge_at = newNextChargeAt;
        }
        // Only set user_id/profile_id if we have them from the order (don't guess)
        if (linkOrder.user_id) psData.user_id = linkOrder.user_id;
        if (profile?.id) psData.profile_id = profile.id;
        // Set amount from plan if available
        if (body.plan?.amount) psData.amount_cents = body.plan.amount;
        if (body.plan?.currency) psData.currency = body.plan.currency;

        const { error: psUpsertErr } = await supabase
          .from('provider_subscriptions')
          .upsert(psData, { onConflict: 'provider,provider_subscription_id' });

        if (psUpsertErr) {
          console.error('[WEBHOOK-LINK-ORDER] provider_subscriptions upsert FAILED:', psUpsertErr.message);
          try {
            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_label: 'bepaid-webhook',
              action: 'bepaid.webhook.provider_subscriptions_write_failed',
              meta: { order_id: linkOrder.id, sbs_id: subscriptionId, error_code: psUpsertErr.code, error_message: psUpsertErr.message },
            });
          } catch (_) {}
        } else {
          console.log('[WEBHOOK-LINK-ORDER] provider_subscriptions upserted OK');
        }
      }

      // ===================================================================
      // §A.2 REBILL Materialization dispatcher (kill-switch + mode=on wired).
      // env BEPAID_REBILL_MATERIALIZATION = off | dry_run | on  (default off).
      //   off    : no-op, legacy grant runs as before.
      //   dry_run: side-channel audit `bepaid.rebill.dry_run` без DML/grant;
      //            legacy grant продолжает работать.
      //   on     : runs full REBILL flow. On terminal outcome (handled),
      //            sets `rebillShortCircuit=true` → step 6 legacy grant SKIPPED
      //            to prevent double-grant.
      // Все critical errors внутри dispatcher — non-fatal, fall back to legacy.
      // Tests: bepaid-webhook/rebill_flow_test.ts + rebill_wiring_test.ts.
      // ===================================================================
      let rebillShortCircuit = false;
      let rebillResultDecision: string | null = null;
      try {
        const { resolveKillSwitchMode } = await import('./rebill_builders.ts');
        const rebillMode = resolveKillSwitchMode(Deno.env.get('BEPAID_REBILL_MATERIALIZATION'));
        if (rebillMode !== 'off') {
          const { runRebillFlow } = await import('./rebill_flow.ts');
          const incomingSbs = subscriptionId ? String(subscriptionId) : null;
          const sbsCheck = await (async () => {
            if (!incomingSbs || !linkOrder.user_id || !linkOrder.product_id || !linkOrder.tariff_id) {
              return { mismatch: false } as const;
            }
            const { data: candidate } = await supabase
              .from('subscriptions_v2').select('id, meta')
              .eq('user_id', linkOrder.user_id)
              .eq('product_id', linkOrder.product_id)
              .eq('tariff_id', linkOrder.tariff_id)
              .in('status', ['active', 'paid'])
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (!candidate) return { mismatch: false } as const;
            const candSbs = ((candidate.meta as any) || {}).bepaid_subscription_id || null;
            return candSbs && String(candSbs) !== incomingSbs
              ? { mismatch: true, foreignSbs: String(candSbs), candidateSubId: candidate.id } as const
              : { mismatch: false } as const;
          })();

          // Build deps. For dry_run, write-deps throw; orchestrator never calls them.
          const isDryRun = rebillMode === 'dry_run';
          const liveDeps = {
            findRebillOrderByOrderNumber: async (orderNumber: string) => {
              const { data } = await supabase.from('orders_v2')
                .select('id, order_number, meta')
                .eq('order_number', orderNumber).maybeSingle();
              return data ? { id: data.id, order_number: data.order_number, meta: data.meta as any } : null;
            },
            findMainPaymentByUid: async (uid: string) => {
              // amendment 7: only main payment row (Платеж/payment).
              const { data } = await supabase.from('payments_v2')
                .select('id, order_id, transaction_type, amount, status')
                .eq('provider', 'bepaid')
                .eq('provider_payment_id', uid)
                .in('transaction_type', ['Платеж', 'payment'])
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
              return data ?? null;
            },
            sumRefundsForPaymentUid: async (uid: string) => {
              // refund-rows linked via meta.parent_payment_uid OR matching uid w/ refund tx_type.
              const { data } = await supabase.from('payments_v2')
                .select('amount, transaction_type, meta')
                .or(`provider_payment_id.eq.${uid},meta->>parent_payment_uid.eq.${uid}`);
              if (!data) return 0;
              let sum = 0;
              for (const r of data as any[]) {
                const t = String(r.transaction_type || '').toLowerCase();
                const isRefund = t.includes('refund') || t.includes('возврат') ||
                  String((r.meta || {}).type || '').toLowerCase() === 'refund' ||
                  (Number(r.amount) || 0) < 0;
                if (isRefund) sum += Math.abs(Number(r.amount) || 0);
              }
              return sum;
            },
            checkSbsMismatchBeforeRebill: async () => sbsCheck,
            insertRebillOrder: isDryRun
              ? async () => { throw new Error('dry_run must not insert'); }
              : async (payload: any) => {
                  const { data, error } = await supabase.from('orders_v2')
                    .insert(payload).select('id').single();
                  if (error) throw new Error(`${error.code || ''}: ${error.message}`);
                  return { id: data!.id };
                },
            insertPaymentRow: isDryRun
              ? async () => { throw new Error('dry_run must not insert payment'); }
              : async (input: any) => {
                  const { data, error } = await supabase.from('payments_v2').insert({
                    order_id: input.rebill_order_id,
                    user_id: input.userId, profile_id: input.profileId,
                    provider: 'bepaid', provider_payment_id: input.payment_uid,
                    transaction_type: 'Платеж',
                    status: 'paid',
                    amount: input.payment.amount,
                    currency: input.payment.currency || 'BYN',
                    paid_at: input.payment.paid_at,
                    meta: { source: 'bepaid_rebill_materialization',
                            bepaid_subscription_id: input.subscriptionId },
                  }).select('id').single();
                  if (error) throw new Error(`${error.code || ''}: ${error.message}`);
                  return { payment_id: data!.id };
                },
            updatePaymentOrderId: isDryRun
              ? async () => { throw new Error('dry_run must not update payment'); }
              : async (input: any) => {
                  const { error } = await supabase.from('payments_v2')
                    .update({ order_id: input.rebill_order_id })
                    .eq('id', input.payment_id);
                  if (error) throw new Error(`${error.code || ''}: ${error.message}`);
                },
            invokeGrantAccess: isDryRun
              ? async () => { throw new Error('dry_run must not invoke grant'); }
              : async (rebillOrderId: string) => {
                  const resp = await fetch(
                    `${Deno.env.get('SUPABASE_URL')}/functions/v1/grant-access-for-order`,
                    { method: 'POST',
                      headers: { 'Content-Type': 'application/json',
                                 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
                      body: JSON.stringify({ orderId: rebillOrderId }) });
                  const json = await resp.json().catch(() => ({}));
                  if (!resp.ok) throw new Error(`grant_http_${resp.status}: ${JSON.stringify(json)}`);
                  return json;
                },
            mergeOrderMeta: isDryRun
              ? async () => { /* dry_run: no DML */ }
              : async (input: any) => {
                  const { data: cur } = await supabase.from('orders_v2')
                    .select('meta').eq('id', input.orderId).maybeSingle();
                  const merged = { ...(cur?.meta || {}), ...input.patch };
                  const { error } = await supabase.from('orders_v2')
                    .update({ meta: merged }).eq('id', input.orderId);
                  if (error) throw new Error(`${error.code || ''}: ${error.message}`);
                },
            writeAudit: async (input: any) => {
              await supabase.from('audit_logs').insert({
                actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
                action: input.action, meta: input.meta, created_at: new Date().toISOString(),
              });
            },
          };

          const rebillResult = await runRebillFlow(liveDeps, {
            mode: rebillMode,
            parentOrder: linkOrder as any,
            payment: { uid: transactionUid, amount: paymentAmount,
                       paid_at: transaction?.paid_at || new Date().toISOString(),
                       currency: transaction?.currency || 'BYN' },
            subscriptionId: incomingSbs,
          });
          rebillResultDecision = rebillResult.decision;

          // PATCH H3.x-a (B-3): unconditional audit coverage for every rebill decision.
          // Contract: каждое решение (would_materialize / materialized / skipped /
          // conflict / manual_review / dry_run_only / off_noop / error) → audit-row
          // с provider_payment_id, sbs, order_id, subscription_v2_id, decision, mode.
          // Дополнительно для admin_subscription branch — отдельный action
          // `admin_subscription.audit_coverage_fixed` (закрывает 50%→100% coverage gap из H4 §B-3).
          try {
            const linkMetaType = (linkOrder as any)?.meta?.type ?? null;
            const isAdminSubscription = typeof linkMetaType === 'string'
              && (linkMetaType === 'admin_payment_link_subscription'
                  || linkMetaType === 'admin_subscription');
            const decisionAuditMeta = {
              decision: rebillResult.decision,
              mode: rebillMode,
              provider_payment_id: transactionUid,
              sbs: incomingSbs,
              parent_order_id: linkOrder.id,
              rebill_order_id: rebillResult.rebill_order_id ?? null,
              subscription_v2_id: (rebillResult as any)?.subscription_v2_id ?? null,
              link_meta_type: linkMetaType,
            };
            await supabase.from('audit_logs').insert({
              actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
              action: 'bepaid.rebill.decision_audit',
              meta: decisionAuditMeta,
              created_at: new Date().toISOString(),
            });
            if (isAdminSubscription) {
              await supabase.from('audit_logs').insert({
                actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
                action: 'admin_subscription.audit_coverage_fixed',
                meta: decisionAuditMeta,
                created_at: new Date().toISOString(),
              });
            }
          } catch (auditErr) {
            console.error('[REBILL-DISPATCHER] H3.x-a decision audit insert failed (non-fatal):', auditErr);
          }

          // mode=on: any non-off_noop terminal → short-circuit legacy grant (handled).
          if (rebillMode === 'on' && !rebillResult.proceedLegacy) {
            rebillShortCircuit = true;
            console.log('[REBILL-DISPATCHER] mode=on handled, decision=' + rebillResult.decision +
                        ' rebill_order_id=' + (rebillResult.rebill_order_id || 'n/a') +
                        ' → short-circuit legacy grant');
          }
        }
      } catch (rebillErr) {
        // amendment 9: errors do not block legacy fallback path.
        console.error('[REBILL-DISPATCHER] non-fatal:', rebillErr);
        try {
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
            action: 'bepaid.rebill.dispatcher_error',
            meta: { error: String((rebillErr as Error)?.message || rebillErr),
                    uid: transactionUid, parent_order_id: linkOrder.id },
            created_at: new Date().toISOString(),
          });
        } catch (_) {}
      }

      // 6. Grant access via grant-access-for-order
      // §A.2 short-circuit: if REBILL flow handled (mode=on terminal), skip legacy grant
      // to prevent double-grant. Downstream subscription resolution + date sync still run.
      let grantedSubscriptionV2Id: string | null = null;
      // PATCH H2: track canonical writer outcome so INLINE block can refuse
      // to fallback-write access dates if writer skipped / failed.
      let grantOutcome: 'ok' | 'skip' | 'error' | 'short_circuit' = 'ok';
      let grantDecisionLabel: string | null = null;
      if (rebillShortCircuit) {
        console.log('[WEBHOOK-LINK-ORDER] legacy grant SKIPPED — REBILL handled (decision=' +
                    (rebillResultDecision || 'unknown') + ')');
        grantOutcome = 'short_circuit';
        grantDecisionLabel = rebillResultDecision || 'rebill_short_circuit';
      } else {
      try {
        const grantResp = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/grant-access-for-order`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ orderId: linkOrder.id }),
          }
        );
        const grantResult = await grantResp.json();
        console.log('[WEBHOOK-LINK-ORDER] grant-access-for-order result:', grantResp.status, grantResult);
        
        // PATCH P2.1: If grant-access failed — log CRITICAL audit + webhook_event
        if (!grantResp.ok) {
          console.error('[WEBHOOK-LINK-ORDER] grant-access FAILED:', grantResp.status, grantResult);
          grantOutcome = 'error';
          grantDecisionLabel = `http_${grantResp.status}`;
          try {
            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_label: 'bepaid-webhook',
              action: 'bepaid.webhook.grant_access_failed',
              meta: {
                order_id: linkOrder.id,
                order_number: linkOrder.order_number,
                http_status: grantResp.status,
                error: grantResult?.error || grantResult?.message || grantResult,
                severity: 'CRITICAL',
              },
            });
          } catch (e) {
            console.error('[WEBHOOK-LINK-ORDER] audit grant_access_failed write error (non-fatal):', e);
          }
          await recordWebhookEvent(supabase, {
            provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
            subscription_id: subscriptionId ? String(subscriptionId) : null,
            tracking_id: rawTrackingId, parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
            outcome: 'failed_grant_access', http_status: 200,
            processing_ms: Date.now() - startTime,
            error_message: `grant-access failed: ${grantResp.status}`,
          });
        } else {
          // PATCH H2: распознаём skip-исходы canonical writer (manual_review / sbs_mismatch /
          // primary_entitlement_*_failed / skip_blocked_stale_access).
          const skippedFlag = grantResult?.skipped === true
            || grantResult?.status === 'skipped'
            || grantResult?.manual_review === true;
          const decision = grantResult?.decision || grantResult?.reason || grantResult?.action || null;
          const isSkipDecision = typeof decision === 'string' && (
            decision.startsWith('skip_') ||
            decision === 'manual_review' ||
            decision === 'sbs_mismatch' ||
            decision.startsWith('primary_entitlement_')
          );
          if (skippedFlag || isSkipDecision) {
            grantOutcome = 'skip';
            grantDecisionLabel = decision || 'skipped';
          }
        }
        
        // PATCH rebill-idempotency-fix-2026-05: read sub id from all possible response shapes,
        // including the idempotent `already_fulfilled` branch where it lives under `existing`.
        grantedSubscriptionV2Id =
          grantResult?.subscription_id ||
          grantResult?.subscription_v2_id ||
          grantResult?.existing?.subscription_id ||
          null;
      } catch (grantErr) {
        console.error('[WEBHOOK-LINK-ORDER] grant-access-for-order error (non-fatal):', grantErr);
        grantOutcome = 'error';
        grantDecisionLabel = 'exception';
      }
      }

      // PATCH rebill-idempotency-fix-2026-05: robust fallback by order_id (no entitlement.status filter).
      // Required so rebill flow extends access even when entitlement is currently `expired`
      // (rebill arrives at/after access_end_at).
      if (!grantedSubscriptionV2Id && linkOrder?.id) {
        try {
          // 1) sub directly bound to this order
          const { data: subByOrder } = await supabase
            .from('subscriptions_v2')
            .select('id')
            .eq('order_id', linkOrder.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (subByOrder) {
            grantedSubscriptionV2Id = subByOrder.id;
          } else {
            // 2) sub previously extended by this order
            const { data: subExtended } = await supabase
              .from('subscriptions_v2')
              .select('id')
              .contains('meta', { extended_by_orders: [linkOrder.id] })
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (subExtended) grantedSubscriptionV2Id = subExtended.id;
          }

          // 3) legacy fallback by user+product (no status filter — rebill may hit after expiry)
          // PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05: при наличии bepaid sbs у webhook'а
          // запрещён "слепой" fallback по user+product. Кандидат обязан иметь
          // тот же bepaid_subscription_id (provider_subscriptions или meta), иначе
          // получим linkage-дефект как у Ларисы (старая sbs продлевает новую sub).
          if (!grantedSubscriptionV2Id && linkOrder.user_id && linkOrder.product_id) {
            const { data: subByUserProduct } = await supabase
              .from('subscriptions_v2')
              .select('id, meta')
              .eq('user_id', linkOrder.user_id)
              .eq('product_id', linkOrder.product_id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (subByUserProduct) {
              if (subscriptionId) {
                // Требуется явный sbs match (provider_subscriptions ИЛИ meta.bepaid_subscription_id).
                const { data: provLink } = await supabase
                  .from('provider_subscriptions')
                  .select('subscription_v2_id')
                  .eq('provider', 'bepaid')
                  .eq('provider_subscription_id', String(subscriptionId))
                  .eq('subscription_v2_id', subByUserProduct.id)
                  .maybeSingle();

                const metaSbs = ((subByUserProduct.meta as any) || {}).bepaid_subscription_id || null;
                const metaMatch = metaSbs && String(metaSbs) === String(subscriptionId);

                if (provLink || metaMatch) {
                  grantedSubscriptionV2Id = subByUserProduct.id;
                } else {
                  console.warn('[WEBHOOK-LINK-ORDER] sbs_mismatch — skip user+product fallback', {
                    webhook_sbs: subscriptionId,
                    candidate_sub_id: subByUserProduct.id,
                    candidate_meta_sbs: metaSbs,
                  });
                  await supabase.from('audit_logs').insert({
                    actor_user_id: null,
                    actor_type: 'system',
                    actor_label: 'bepaid-webhook',
                    action: 'webhook.skip_extend_bepaid_subscription_mismatch',
                    meta: {
                      webhook_subscription_id: String(subscriptionId),
                      order_id: linkOrder.id,
                      user_id: linkOrder.user_id,
                      product_id: linkOrder.product_id,
                      candidate_subscription_v2_id: subByUserProduct.id,
                      candidate_meta_bepaid_sbs: metaSbs,
                      reason: 'user+product fallback denied — bepaid_subscription_id mismatch',
                    },
                  });
                }
              } else {
                // Нет sbs у webhook (one-time / non-recurrent path) — старое поведение.
                grantedSubscriptionV2Id = subByUserProduct.id;
              }
            }
          }

          if (grantedSubscriptionV2Id) {
            console.log('[WEBHOOK-LINK-ORDER] rebill fallback resolved subscription_v2_id=', grantedSubscriptionV2Id);
          }
        } catch (lookupErr) {
          console.error('[WEBHOOK-LINK-ORDER] subscription_v2_id fallback lookup error (non-fatal):', lookupErr);
        }
      }

      if (subscriptionId && grantedSubscriptionV2Id) {
        await supabase
          .from('provider_subscriptions')
          .update({ subscription_v2_id: grantedSubscriptionV2Id })
          .eq('provider', 'bepaid')
          .eq('provider_subscription_id', String(subscriptionId));
        console.log('[WEBHOOK-LINK-ORDER] Linked provider_subscriptions → subscription_v2_id:', grantedSubscriptionV2Id);

        // PATCH P2.8: Update subscriptions_v2 billing_type + bepaid_subscription_id in meta
        try {
          const { data: existingSubV2 } = await supabase
            .from('subscriptions_v2')
            .select('id, meta')
            .eq('id', grantedSubscriptionV2Id)
            .maybeSingle();

          if (existingSubV2) {
            const existingMeta = (existingSubV2.meta as Record<string, any>) || {};
            const v2UpdatePayload: Record<string, any> = {
              meta: { ...existingMeta, bepaid_subscription_id: String(subscriptionId) },
            };
            // STAGE L3 GUARD: для рассрочки billing_type должен оставаться установленным grant'ом
            // (или 'internal_installment' для fallback). НЕ перезаписываем на 'provider_managed'.
            if (!isInstallmentOrder) {
              v2UpdatePayload.billing_type = 'provider_managed';
            }
            await supabase
              .from('subscriptions_v2')
              .update(v2UpdatePayload)
              .eq('id', grantedSubscriptionV2Id);
            console.log('[WEBHOOK-LINK-ORDER] subscriptions_v2 updated: isInstallment=', isInstallmentOrder, 'bepaid_sub_id=', subscriptionId);
          }
        } catch (v2UpdateErr) {
          console.error('[WEBHOOK-LINK-ORDER] subscriptions_v2 billing_type update error (non-fatal):', v2UpdateErr);
        }
      }

      // =====================================================================
      // STAGE L3: INSTALLMENT MATERIALIZATION (public link рассрочка)
      // Триггер: linkOrder.meta.installment_count >= 2 (записан public-checkout из payment_links.meta).
      // Источник графика: order.meta (NOT offer). Per-payment взят AS-IS (round-half-up-byn done by writer L2).
      // Idempotency: pre-check + UNIQUE(order_id, payment_number) внутри generateInstallmentSchedule.
      // НЕ ставим auto_renew=true: рассрочка идёт через installment_payments + installment-charge-cron.
      // =====================================================================
      // STAGE L3: isInstallmentOrder + installmentCountFromOrderMeta объявлены выше (строка 2250).
      const linkOrderMetaForInstallment = (linkOrder.meta || {}) as Record<string, any>;

      if (isInstallmentOrder && linkOrder.user_id) {
        try {
          // 1) Найти/создать subscriptions_v2 для рассрочки.
          //    Правило: если grant-access-for-order уже создал sub (grantedSubscriptionV2Id) — используем её,
          //    НЕ перезаписывая billing_type, который мог быть установлен grant'ом.
          //    Только если sub отсутствует (fallback) — создаём новую с допустимым billing_type='mit'
          //    + meta.model='internal_installment' (CHECK constraint subscriptions_v2_billing_type_check
          //    допускает только 'mit'|'provider_managed'; 'internal_installment' как значение колонки запрещено).
          let installmentSubV2Id: string | null = grantedSubscriptionV2Id;

          if (!installmentSubV2Id) {
            // Доказанное отсутствие — создаём fallback subscription.
            const { data: createdSub, error: createSubErr } = await supabase
              .from('subscriptions_v2')
              .insert({
                user_id: linkOrder.user_id,
                product_id: linkOrder.product_id,
                tariff_id: linkOrder.tariff_id,
                order_id: linkOrder.id,
                status: 'active',
                billing_type: 'mit',
                auto_renew: false,
                meta: {
                  source: 'bepaid_link_order_installment_fallback',
                  order_id: linkOrder.id,
                  installment_count: installmentCountFromOrderMeta,
                  model: 'internal_installment',
                },
              })
              .select('id')
              .single();
            if (createSubErr) {
              console.error('[WEBHOOK-LINK-ORDER][INSTALLMENT] fallback subscription create FAILED:', createSubErr);
              await supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_label: 'bepaid-webhook',
                action: 'bepaid.webhook.installment_subscription_create_failed',
                meta: { order_id: linkOrder.id, error: createSubErr.message },
              });
            } else {
              installmentSubV2Id = createdSub.id;
              console.log('[WEBHOOK-LINK-ORDER][INSTALLMENT] fallback subscription created:', installmentSubV2Id);
            }
          }

          // 2) Материализуем график через canonical helper (scheduleSource='order_meta').
          if (installmentSubV2Id) {
            const firstPaymentId = (payUpsertResult as any)?.id ?? null;
            const scheduleResult = await generateInstallmentSchedule({
              supabase,
              offer: null, // в order_meta-режиме offer не нужен
              order: { id: linkOrder.id, meta: linkOrderMetaForInstallment },
              subscription: { id: installmentSubV2Id },
              user: { id: linkOrder.user_id },
              totalAmount: Number(linkOrderMetaForInstallment.installment_total_amount_byn ?? 0),
              currency: linkOrder.currency || 'BYN',
              firstPayment: { paymentId: firstPaymentId },
              scheduleSource: 'order_meta',
            });

            console.log('[WEBHOOK-LINK-ORDER][INSTALLMENT] generateInstallmentSchedule result:', scheduleResult);

            if (!('ok' in scheduleResult) || !scheduleResult.ok) {
              await supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_label: 'bepaid-webhook',
                action: 'bepaid.webhook.installment_schedule_failed',
                meta: {
                  order_id: linkOrder.id,
                  subscription_id: installmentSubV2Id,
                  error: (scheduleResult as any)?.error,
                  details: (scheduleResult as any)?.details,
                  severity: 'CRITICAL',
                },
              });
            }
          }
        } catch (instErr) {
          console.error('[WEBHOOK-LINK-ORDER][INSTALLMENT] unexpected error (non-fatal):', instErr);
        }
      }

      // =====================================================================

      // Without this, renewals rely on delayed sync to update access_end_at/expires_at
      // =====================================================================
      if (grantedSubscriptionV2Id) {
        try {
          const now = new Date();
          const bepaidActiveTo = body.active_to || body.subscription?.active_to;
          const bepaidRenewAt = body.renew_at || body.subscription?.renew_at;

          // Read current subscription for tariff info
          const { data: linkSubV2 } = await supabase
            .from('subscriptions_v2')
            .select('id, user_id, product_id, tariff_id, access_end_at, meta, tariffs(access_days, getcourse_offer_id, code, name), products_v2(id, code, name)')
            .eq('id', grantedSubscriptionV2Id)
            .maybeSingle();

          if (linkSubV2) {
            const accessDays = (linkSubV2.tariffs as any)?.access_days || 30;

            // OVERSHOOT GUARD (bepaid-active-to-overshoot-guard):
            // bePaid `/subscriptions` после первого charge возвращает active_to,
            // смещённый на +1 billing cycle вперёд (active_to = next_charge_at + 1 cycle).
            // SOT для access_end_at — grant-access-for-order → calcCalendarMonthEnd, уже
            // записанный в subscriptions_v2.access_end_at. Применяем bePaid candidate
            // только если он внутри окна [expected_end, expected_end + tolerance].
            // Если кандидат выходит за tolerance — это overshoot bug, skip перезаписи.

            const expectedEnd = (linkSubV2.access_end_at as string | null)
              ? new Date(linkSubV2.access_end_at as string)
              : null;
            const toleranceMs = Math.max(
              Math.round(accessDays * 1.5),
              accessDays + 5
            ) * 24 * 60 * 60 * 1000;

            let bepaidCandidate: Date | null = null;
            let candidateSource: 'bepaid_active_to' | 'fallback_access_days' = 'fallback_access_days';
            if (bepaidActiveTo) {
              bepaidCandidate = new Date(endOfDayAppTz(bepaidActiveTo));
              candidateSource = 'bepaid_active_to';
            }

            // PATCH 12.1 (stale-local recovery):
            // Internal SOT for "where access SHOULD reach after this rebill" =
            //   expected_min_end = paid_at + accessDays.
            // If local subscriptions_v2.access_end_at is older than paid_at, it is
            // a stale baseline (legacy backfill / earlier expired cycle), and we
            // MUST NOT use it as overshoot anchor — otherwise normal +30 days
            // bePaid renewal looks like 100+ days overshoot and gets rejected.
            const paidAtIso = (transaction as any)?.paid_at || (body as any)?.paid_at || null;
            const paidAt = paidAtIso ? new Date(paidAtIso) : now;
            const expectedMinEnd = new Date(
              endOfDayAppTz(new Date(paidAt.getTime() + accessDays * 24 * 60 * 60 * 1000).toISOString())
            );
            const isStaleLocal = !!expectedEnd && (
              expectedEnd.getTime() < paidAt.getTime() ||
              expectedEnd.getTime() < now.getTime()
            );

            // Determine final accessEndAt
            let accessEndAt: Date;
            let endAtAction:
              | 'apply_candidate'
              | 'keep_existing_overshoot'
              | 'fallback_no_candidate'
              | 'stale_local_end_recovered'
              = 'apply_candidate';

            if (!bepaidCandidate) {
              // No bePaid date at all — fallback to +accessDays from now
              accessEndAt = new Date(now.getTime() + accessDays * 24 * 60 * 60 * 1000);
              endAtAction = 'fallback_no_candidate';
              console.warn('[WEBHOOK-LINK-ORDER] FALLBACK: no active_to from bePaid, using +accessDays');
              await supabase.from('audit_logs').insert({
                action: 'bepaid.webhook.link_order_fallback_access_days',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'bepaid-webhook',
                target_user_id: linkSubV2.user_id,
                meta: { subscription_id: grantedSubscriptionV2Id, access_days: accessDays, reason: 'no_active_to_field' },
              });
            } else if (isStaleLocal) {
              // PATCH 12.1: stale local baseline — bypass overshoot guard, recover
              // access via GREATEST(local, expected_min_end, provider_active_to).
              const candidates = [
                expectedEnd ? expectedEnd.getTime() : 0,
                expectedMinEnd.getTime(),
                bepaidCandidate.getTime(),
              ];
              accessEndAt = new Date(Math.max(...candidates));
              endAtAction = 'stale_local_end_recovered';
              console.warn(
                '[WEBHOOK-LINK-ORDER] STALE LOCAL RECOVERED: local_end=' +
                (expectedEnd ? expectedEnd.toISOString() : 'null') +
                ' < paid_at=' + paidAt.toISOString() +
                '. Using GREATEST(local, expected_min_end, bepaid_active_to)=' +
                accessEndAt.toISOString()
              );
              await supabase.from('audit_logs').insert({
                action: 'bepaid.webhook.stale_local_end_recovered',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'bepaid-webhook',
                target_user_id: linkSubV2.user_id,
                meta: {
                  subscription_id: grantedSubscriptionV2Id,
                  order_id: (typeof linkOrder !== 'undefined' && linkOrder?.id) ? linkOrder.id : null,
                  paid_at: paidAt.toISOString(),
                  local_access_end_at: expectedEnd ? expectedEnd.toISOString() : null,
                  expected_min_end: expectedMinEnd.toISOString(),
                  bepaid_active_to: bepaidCandidate.toISOString(),
                  resolved_access_end_at: accessEndAt.toISOString(),
                  access_days: accessDays,
                  candidate_source: candidateSource,
                  reason: expectedEnd && expectedEnd.getTime() < paidAt.getTime()
                    ? 'local_end_before_paid_at'
                    : 'local_end_in_past',
                  patch: 'patch-12.1-stale-local-recovery',
                },
              });
            } else if (
              expectedEnd &&
              bepaidCandidate.getTime() > expectedEnd.getTime() + toleranceMs
            ) {
              // OVERSHOOT detected on FRESH local baseline: bePaid candidate ahead
              // of expected end by > tolerance. Keep our SOT (expected_end).
              // PATCH 12.1: this branch now only fires when local_end is NOT stale.
              accessEndAt = expectedEnd;
              endAtAction = 'keep_existing_overshoot';
              console.warn(
                '[WEBHOOK-LINK-ORDER] OVERSHOOT GUARD: bePaid active_to=' +
                bepaidCandidate.toISOString() +
                ' overshoots expected_end=' + expectedEnd.toISOString() +
                ' by > ' + Math.round(toleranceMs / 86400000) + ' days. Keeping expected_end.'
              );
              await supabase.from('audit_logs').insert({
                action: 'bepaid.webhook.access_end_at_skipped_overshoot',
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'bepaid-webhook',
                target_user_id: linkSubV2.user_id,
                meta: {
                  subscription_id: grantedSubscriptionV2Id,
                  order_id: (typeof linkOrder !== 'undefined' && linkOrder?.id) ? linkOrder.id : null,
                  expected_end: expectedEnd.toISOString(),
                  bepaid_active_to: bepaidCandidate.toISOString(),
                  overshoot_days: Math.round(
                    (bepaidCandidate.getTime() - expectedEnd.getTime()) / 86400000
                  ),
                  tolerance_days: Math.round(toleranceMs / 86400000),
                  access_days: accessDays,
                  candidate_source: candidateSource,
                  guard: 'bepaid_active_to_overshoot_guard',
                  is_stale_local: false,
                },
              });
            } else {
              // Candidate within tolerance — apply (renewal flow).
              // GREATEST defended: never decrease access_end_at silently.
              if (expectedEnd && bepaidCandidate.getTime() < expectedEnd.getTime()) {
                accessEndAt = expectedEnd;
                console.log('[WEBHOOK-LINK-ORDER] candidate < expected_end, keeping expected (GREATEST)');
              } else {
                accessEndAt = bepaidCandidate;
              }
            }

            // renewAt: same guard logic (если есть expected, не уезжаем дальше tolerance)
            let renewAt: Date;
            if (bepaidRenewAt) {
              const renewCandidate = new Date(bepaidRenewAt);
              if (
                expectedEnd &&
                renewCandidate.getTime() > expectedEnd.getTime() + toleranceMs
              ) {
                renewAt = accessEndAt; // align to safe accessEndAt
              } else {
                renewAt = renewCandidate;
              }
            } else {
              renewAt = accessEndAt;
            }

            // ============================================================
            // PATCH H2: CANONICAL-WRITER-ONLY. Webhook больше НЕ пишет
            // access_end_at / next_charge_at / status / entitlements /
            // telegram_access напрямую. Эти поля владеет grant-access-for-order.
            // Здесь только provider-sync технических биллинг-полей и audit.
            // ============================================================

            // 1. subscriptions_v2 provider-sync — ТОЛЬКО billing_type / auto_renew /
            // meta.bepaid_subscription_id. Никаких access dates / status.
            const existingSubMeta = (linkSubV2.meta as Record<string, any>) || {};
            if (!isInstallmentOrder && grantOutcome !== 'skip' && grantOutcome !== 'error') {
              try {
                await supabase
                  .from('subscriptions_v2')
                  .update({
                    billing_type: 'provider_managed',
                    auto_renew: true,
                    meta: {
                      ...existingSubMeta,
                      bepaid_subscription_id: String(subscriptionId),
                      bepaid_activated_at: now.toISOString(),
                    },
                  })
                  .eq('id', grantedSubscriptionV2Id);
                console.log('[WEBHOOK-LINK-ORDER] H2 provider-sync: billing_type/auto_renew/meta updated');
              } catch (provSyncErr) {
                console.error('[WEBHOOK-LINK-ORDER] H2 provider-sync (non-fatal):', provSyncErr);
              }
            } else if (grantOutcome === 'skip' || grantOutcome === 'error') {
              // canonical writer не подтвердил grant → не двигаем даже provider-sync,
              // случай уходит в manual_review.
              await supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'bepaid-webhook',
                action: 'bepaid.webhook.grant_skipped_no_fallback',
                target_user_id: linkSubV2.user_id,
                meta: {
                  patch: 'patch-h2-canonical-writer-only',
                  decision: grantDecisionLabel,
                  outcome: grantOutcome,
                  order_id: linkOrder.id,
                  subscription_v2_id: grantedSubscriptionV2Id,
                  provider_subscription_id: subscriptionId ? String(subscriptionId) : null,
                  computed_access_end_at_skipped: accessEndAt.toISOString(),
                  computed_renew_at_skipped: renewAt.toISOString(),
                  end_at_action_planned: endAtAction,
                  bepaid_active_to: bepaidActiveTo || null,
                  bepaid_renew_at: bepaidRenewAt || null,
                  note: 'Direct webhook access writes removed (PATCH H2). Manual review.',
                },
              });
              console.warn(
                '[WEBHOOK-LINK-ORDER] H2: grant outcome=' + grantOutcome +
                ' decision=' + grantDecisionLabel + ' → NO direct access writes, manual review queued.'
              );
            }

            // 2. entitlements — REMOVED (PATCH H2). Канонический writer владеет.
            // 3. telegram_access — REMOVED (PATCH H2). Канонический writer → telegram-grant-access.

            // 4. GetCourse sync (parity with subv2 handler) — external integration,
            // не является access-grant, остаётся в webhook.
            const getcourseOfferId = (linkSubV2.tariffs as any)?.getcourse_offer_id;
            const tariffCode = (linkSubV2.tariffs as any)?.code || (linkSubV2.tariffs as any)?.name || 'subscription';
            if (getcourseOfferId && grantOutcome === 'ok') {
              try {
                const { data: profileForGC } = await supabase
                  .from('profiles')
                  .select('email, phone, first_name, last_name, full_name')
                  .eq('user_id', linkSubV2.user_id)
                  .maybeSingle();

                const paymentEmail = transaction?.customer?.email || body.customer?.email;
                const gcEmail = profileForGC?.email || paymentEmail || linkOrder.customer_email;

                if (gcEmail) {
                  let firstName = profileForGC?.first_name;
                  let lastName = profileForGC?.last_name;
                  if (!firstName && profileForGC?.full_name) {
                    const parts = profileForGC.full_name.split(' ');
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' ');
                  }

                  const gcResult = await sendToGetCourse(
                    { email: gcEmail, phone: profileForGC?.phone || null, firstName: firstName || null, lastName: lastName || null },
                    parseInt(String(getcourseOfferId), 10) || 0,
                    linkOrder.order_number || `LINK-${linkOrder.id.slice(0, 8)}`,
                    paymentAmount,
                    tariffCode
                  );

                  const orderMeta = (linkOrder.meta && typeof linkOrder.meta === 'object') ? linkOrder.meta : {};
                  await supabase.from('orders_v2').update({
                    meta: {
                      ...orderMeta,
                      gc_sync_status: gcResult.success ? 'success' : 'failed',
                      gc_sync_error: gcResult.error || null,
                      gc_order_id: gcResult.gcOrderId || null,
                      gc_deal_number: gcResult.gcDealNumber || null,
                      gc_synced_at: new Date().toISOString(),
                    },
                  }).eq('id', linkOrder.id);

                  await supabase.from('audit_logs').insert({
                    actor_type: 'system',
                    actor_user_id: null,
                    actor_label: 'bepaid-webhook',
                    action: gcResult.success ? 'gc_sync_success' : 'gc_sync_failed',
                    target_user_id: linkSubV2.user_id,
                    meta: {
                      order_id: linkOrder.id,
                      order_number: linkOrder.order_number,
                      gc_offer_id: getcourseOfferId,
                      gc_order_id: gcResult.gcOrderId,
                      error: gcResult.error,
                      source: 'link_order_webhook_inline',
                    },
                  });
                  console.log('[WEBHOOK-LINK-ORDER] INLINE: GetCourse sync:', gcResult.success ? 'OK' : gcResult.error);
                } else {
                  console.log('[WEBHOOK-LINK-ORDER] INLINE: GetCourse sync skipped: no email');
                }
              } catch (gcErr) {
                console.error('[WEBHOOK-LINK-ORDER] GetCourse sync error (non-fatal):', gcErr);
              }
            }

            // 5. Audit — заменён на canonical_writer_only marker.
            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_user_id: null,
              actor_label: 'bepaid-webhook',
              action: 'bepaid.webhook.canonical_writer_only',
              target_user_id: linkSubV2.user_id,
              meta: {
                patch: 'patch-h2-canonical-writer-only',
                subscription_v2_id: grantedSubscriptionV2Id,
                order_id: linkOrder.id,
                provider_subscription_id: String(subscriptionId),
                grant_outcome: grantOutcome,
                grant_decision: grantDecisionLabel,
                computed_access_end_at: accessEndAt.toISOString(),
                computed_renew_at: renewAt.toISOString(),
                end_at_action: endAtAction,
                bepaid_active_to: bepaidActiveTo || null,
                bepaid_renew_at: bepaidRenewAt || null,
                used_fallback: !bepaidActiveTo,
                gc_offer_id: getcourseOfferId || null,
                note: 'Access dates / entitlements / telegram_access NOT written from webhook (canonical-only).',
              },
            });
          }
        } catch (inlineErr) {
          console.error('[WEBHOOK-LINK-ORDER] INLINE dates update error (non-fatal):', inlineErr);
        }
      }

      // 7. PATCH P2: Admin notification with PII masking
      try {
        const { data: customerProfile } = await supabase
          .from('profiles')
          .select('full_name, email, telegram_username')
          .eq('user_id', linkOrder.user_id)
          .maybeSingle();

        // Lookup product and tariff names for link-payment notification
        let linkProductName: string | undefined;
        let linkTariffName: string | undefined;
        if (linkOrder.product_id) {
          const { data: lp } = await supabase.from('products_v2').select('name').eq('id', linkOrder.product_id).maybeSingle();
          linkProductName = lp?.name || undefined;
        }
        if (linkOrder.tariff_id) {
          const { data: lt } = await supabase.from('tariffs').select('name').eq('id', linkOrder.tariff_id).maybeSingle();
          linkTariffName = lt?.name || undefined;
        }

        const notifyMessage = buildAdminNotifyMessage({
          operation_type: 'link_payment',
          client_name: customerProfile?.full_name,
          email: customerProfile?.email || linkOrder.customer_email,
          telegram_username: customerProfile?.telegram_username,
          product_name: linkProductName,
          tariff_name: linkTariffName,
          amount: paymentAmount,
          currency: 'BYN',
          source_label: 'Оплата по ссылке bePaid',
        });

        await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-notify-admins`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({
              message: notifyMessage,
              source: 'bepaid_link_order_webhook',
              order_id: linkOrder.id,
            }),
          }
        );
        console.log('[WEBHOOK-LINK-ORDER] Admin notification sent');
      } catch (notifyErr) {
        console.error('[WEBHOOK-LINK-ORDER] Notification error (non-fatal):', notifyErr);
      }

      // 8. Audit log
      try {
        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: 'bepaid.webhook.link_order_processed',
          meta: {
            order_id: linkOrder.id,
            order_number: linkOrder.order_number,
            transaction_uid: transactionUid,
            subscription_id: subscriptionId,
            subscription_v2_id: grantedSubscriptionV2Id,
            amount: paymentAmount,
            currency: transaction?.currency || 'BYN',
          },
        });
      } catch (auditErr) {
        console.error('[WEBHOOK-LINK-ORDER] Audit log error (non-fatal):', auditErr);
      }

      await recordWebhookEvent(supabase, {
        provider: 'bepaid', event_type: 'subscription', transaction_uid: transactionUid,
        tracking_id: rawTrackingId, subscription_id: subscriptionId ? String(subscriptionId) : null,
        parsed_kind: tracking.kind, parsed_order_id: parsedOrderId,
        outcome: 'processed', http_status: 200,
        processing_ms: Date.now() - startTime,
      });
      return new Response(JSON.stringify({ ok: true, status: 'processed', order_id: linkOrder.id }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // End of PATCH-LINK handler
    // =====================================================================

    // =====================================================================
    // PATCH-LINK-LEGACY: Handle tracking_id formats:
    //   - link:{UUID} (kind='link') — legacy one-time payments
    //   - link:order:{UUID} (kind='link_order') — canonical one-time paylink flow
    //     (only when NOT a subscription webhook; subscription link_order is handled
    //      exclusively by PATCH-LINK above — STOP-GUARD against double-processing)
    // Uses idempotent upsertPaymentV2 helper, canonical provider_payment_id dedup.
    // Supports transactionStatus: successful, settled, authorized → succeeded
    // =====================================================================
    // STOP-GUARD: link_order + isSubscriptionWebhook → must ONLY go to PATCH-LINK (line ~1839).
    // This flag is strictly false for subscription webhooks to prevent double-processing.
    const isOneTimeLinkOrderWebhook = !isSubscriptionWebhook && tracking.kind === 'link_order';

    if ((tracking.kind === 'link' || isOneTimeLinkOrderWebhook) && parsedOrderId && transactionUid) {
      const effectiveKind = isOneTimeLinkOrderWebhook ? 'link_order' : 'link';
      const isLinkSuccessful = transactionStatus === 'successful' || transactionStatus === 'settled' || transactionStatus === 'authorized';
      console.log('[WEBHOOK-LINK] Processing webhook:', { effectiveKind, parsedOrderId, transactionUid, transactionStatus, isLinkSuccessful, isOneTimeLinkOrderWebhook });

      // Audit marker: log that webhook entered via the new one-time link_order route
      if (isOneTimeLinkOrderWebhook) {
        const { error: routeAuditErr } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: 'bepaid.webhook.one_time_link_order_routed',
          created_at: new Date().toISOString(),
          meta: {
            order_id: parsedOrderId,
            transaction_uid: transactionUid,
            tracking_id: rawTrackingId,
            bepaid_status: transactionStatus,
          },
        });
        if (routeAuditErr) console.error('[WEBHOOK-LINK] Route audit log error (non-fatal):', routeAuditErr);
      }

      // 1) IDEMPOTENCY / CONFLICT: check payments_v2 by provider_payment_id
      const { data: existingLinkPayment } = await supabase
        .from('payments_v2')
        .select('id, order_id, origin, status')
        .eq('provider_payment_id', transactionUid)
        .eq('provider', 'bepaid')
        .maybeSingle();

      if (existingLinkPayment) {
        // True idempotency only if same order
        if (existingLinkPayment.order_id === parsedOrderId) {
          // FIX-B: Idempotency upgrade — allow failed/processing → succeeded
          const existingStatus = (existingLinkPayment as any).status as string | null;
          
          // DO-NOT-DOWNGRADE: if already succeeded, always return already_processed
          if (existingStatus === 'succeeded') {
            console.log('[WEBHOOK-LINK] Already succeeded (DO-NOT-DOWNGRADE):', transactionUid);
            try {
              await supabase.from('payment_reconcile_queue')
                .update({ status: 'materialized', processed_at: new Date().toISOString(), last_error: null })
                .eq('bepaid_uid', transactionUid);
            } catch (_) {}
            await recordWebhookEvent(supabase, {
              provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
              tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
              outcome: 'already_processed', http_status: 200, processing_ms: Date.now() - startTime,
            });
            return new Response(JSON.stringify({ ok: true, status: 'already_processed', reason: 'already_succeeded' }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          // UPGRADE PATH: existing is failed/processing and incoming is successful → allow through
          if (['failed', 'processing'].includes(existingStatus || '') && isLinkSuccessful) {
            console.log(`[WEBHOOK-LINK] UPGRADE ${existingStatus} → succeeded for:`, transactionUid);
            // Fall through to success path — do NOT return
          } else if (['failed', 'processing'].includes(existingStatus || '') && !isLinkSuccessful) {
            // Allow update of failed/processing with new non-successful status (e.g. processing→failed)
            console.log(`[WEBHOOK-LINK] UPDATE ${existingStatus} with incoming ${transactionStatus}:`, transactionUid);
            // Fall through to !isLinkSuccessful branch — do NOT return
          } else {
            // Default: already_processed (e.g. processing→pending duplicate)
            console.log('[WEBHOOK-LINK] Already processed (idempotency):', transactionUid);
            try {
              await supabase.from('payment_reconcile_queue')
                .update({ status: 'materialized', processed_at: new Date().toISOString(), last_error: null })
                .eq('bepaid_uid', transactionUid);
            } catch (_) {}
            await recordWebhookEvent(supabase, {
              provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
              tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
              outcome: 'already_processed', http_status: 200, processing_ms: Date.now() - startTime,
            });
            return new Response(JSON.stringify({ ok: true, status: 'already_processed' }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
        // CONFLICT: provider_payment_id exists but linked to different order_id
        console.warn('[WEBHOOK-LINK] CONFLICT provider_payment_id linked to other order:', {
          transactionUid,
          existing_order_id: existingLinkPayment.order_id,
          tracking_order_id: parsedOrderId,
          origin: (existingLinkPayment as any).origin,
        });

        await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: 'payment_link.conflict_provider_payment_id',
          meta: {
            transaction_uid: transactionUid,
            tracking_id: rawTrackingId,
            parsed_kind: effectiveKind,
            existing_payment_id: existingLinkPayment.id,
            existing_order_id: existingLinkPayment.order_id,
            tracking_order_id: parsedOrderId,
            origin: (existingLinkPayment as any).origin || null,
          },
        });

        try {
          await supabase
            .from('payment_reconcile_queue')
            .update({
              status: 'pending_needs_mapping',
              last_error: `conflict: provider_payment_id linked to order ${existingLinkPayment.order_id}, tracking wants ${parsedOrderId}`,
              processed_at: null,
            })
            .eq('bepaid_uid', transactionUid);
        } catch (_) {}

        await recordWebhookEvent(supabase, {
          provider: 'bepaid',
          event_type: 'payment_link',
          transaction_uid: transactionUid,
          tracking_id: rawTrackingId,
          parsed_kind: effectiveKind,
          parsed_order_id: parsedOrderId,
          outcome: 'conflict_provider_payment_id',
          http_status: 202,
          processing_ms: Date.now() - startTime,
        });

        return new Response(
          JSON.stringify({
            ok: false,
            status: 'conflict',
            reason: 'provider_payment_id_linked_to_different_order',
            existing_order_id: existingLinkPayment.order_id,
            tracking_order_id: parsedOrderId,
          }),
          { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
        }
      }

      // 2. Find order in orders_v2
      const { data: linkOrderV2 } = await supabase
        .from('orders_v2')
        .select('*')
        .eq('id', parsedOrderId)
        .maybeSingle();

      if (!linkOrderV2) {
        console.warn('[WEBHOOK-LINK] Order not found in orders_v2:', parsedOrderId);
        try {
          await supabase.from('payment_reconcile_queue')
            .update({ status: 'pending_needs_mapping', last_error: 'link_order_not_found_in_orders_v2', processed_at: null })
            .eq('bepaid_uid', transactionUid);
        } catch (_) {}
        await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_label: 'bepaid-webhook',
          action: 'payment_link.unmatched',
          meta: { order_id: parsedOrderId, transaction_uid: transactionUid, tracking_id: rawTrackingId },
        });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'link_order_not_found', http_status: 202,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: false, status: 'pending_needs_mapping', reason: 'order_not_found' }), {
          status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // IDEMPOTENCY: order already paid
      if (linkOrderV2.status === 'paid') {
        console.log('[WEBHOOK-LINK] Order already paid (idempotency):', parsedOrderId);
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'already_processed', http_status: 200,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: true, status: 'already_processed', reason: 'order_already_paid' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ====================================================================
      // STEP A: STALE-TOKEN GUARD (one-time link_order)
      // Контекст: после внедрения reuse (Шаг B) по одному order_id может быть
      // несколько checkout-попыток (T1, T2…). Каждая попытка создаёт свой
      // transaction_uid на стороне bePaid. Актуальной считается ТОЛЬКО
      // последняя — meta.active_checkout_token.
      //
      // Алгоритм:
      //   1. Если в order.meta.checkout_tokens_history НЕТ массива → legacy/чистый
      //      сценарий (нет reuse) → guard SKIP, обычная обработка.
      //   2. Иначе ищем transactionUid в history[].observed_uids[]:
      //      - если найден под токеном == active_checkout_token → актуальный, пропускаем;
      //      - если найден под другим (старым) токеном → STALE → audit + return 200;
      //      - если впервые встречается → привязываем к active_checkout_token (append).
      // ====================================================================
      try {
        const linkMeta = (linkOrderV2.meta || {}) as Record<string, any>;
        const activeToken: string | null = linkMeta.active_checkout_token || null;
        const tokensHistory: any[] = Array.isArray(linkMeta.checkout_tokens_history) ? linkMeta.checkout_tokens_history : [];

        if (activeToken && tokensHistory.length > 0 && transactionUid) {
          let foundUnderToken: string | null = null;
          for (const entry of tokensHistory) {
            const observed: string[] = Array.isArray(entry?.observed_uids) ? entry.observed_uids : [];
            if (observed.includes(transactionUid)) {
              foundUnderToken = entry.token || null;
              break;
            }
          }

          if (foundUnderToken && foundUnderToken !== activeToken) {
            // STALE: callback от устаревшего checkout-token'а
            console.warn('[WEBHOOK-LINK] STALE TOKEN: ignoring callback', { order_id: parsedOrderId, transactionUid, foundUnderToken, activeToken });
            await supabase.from('audit_logs').insert({
              actor_type: 'system',
              actor_label: 'bepaid-webhook',
              action: 'webhook_stale_token_ignored',
              created_at: new Date().toISOString(),
              meta: {
                order_id: parsedOrderId,
                transaction_uid: transactionUid,
                stale_token: foundUnderToken,
                active_token: activeToken,
                bepaid_status: transactionStatus,
                tracking_id: rawTrackingId,
              },
            });
            await recordWebhookEvent(supabase, {
              provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
              tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
              outcome: 'stale_token_ignored', http_status: 200,
              processing_ms: Date.now() - startTime,
            });
            return new Response(JSON.stringify({ ok: true, status: 'stale_token_ignored' }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          if (!foundUnderToken) {
            // Впервые видим этот uid → привязываем к active_checkout_token
            const updatedHistory = tokensHistory.map((entry: any) => {
              if (entry?.token === activeToken) {
                const obs: string[] = Array.isArray(entry.observed_uids) ? entry.observed_uids : [];
                return { ...entry, observed_uids: [...obs, transactionUid] };
              }
              return entry;
            });
            await supabase.from('orders_v2').update({
              meta: { ...linkMeta, checkout_tokens_history: updatedHistory },
            }).eq('id', linkOrderV2.id);
            (linkOrderV2 as any).meta = { ...linkMeta, checkout_tokens_history: updatedHistory };
          }
        }
      } catch (guardErr) {
        console.error('[WEBHOOK-LINK] Stale-token guard error (non-fatal):', guardErr);
      }
      // END STEP A guard
      // ====================================================================

      // Handle non-successful statuses
      if (!isLinkSuccessful) {
        console.log('[WEBHOOK-LINK] Non-successful status:', transactionStatus);

        // FIX-A: ERIP pending → processing (NOT failed)
        // STOP-GUARD: only for ERIP, never for card/other methods
        const isErip = paymentMethod === 'erip' || !!transaction?.erip;
        if (isErip && transactionStatus === 'pending') {
          console.log('[WEBHOOK-LINK] ERIP pending detected — storing as processing:', transactionUid);
          const eripPendingAmount = transaction?.amount ? transaction.amount / 100 : 0;
          const eripPendingCurrency = transaction?.currency || 'BYN';
          const eripCustomerEmail = transaction?.customer?.email || linkOrderV2?.customer_email || null;
          const eripCustomerPhone = transaction?.customer?.phone || linkOrderV2?.customer_phone || null;

          const eripPendingRow = {
            order_id: linkOrderV2.id,
            user_id: linkOrderV2.user_id || null,
            profile_id: linkOrderV2.profile_id || null,
            amount: eripPendingAmount,
            currency: eripPendingCurrency,
            status: 'processing',  // NOT failed — ERIP pending is normal intermediate state
            provider: 'bepaid',
            provider_payment_id: transactionUid,
            error_message: null,  // NOT an error
            origin: 'bepaid',
            meta: {
              bepaid_status: transactionStatus,
              last_bepaid_status: transactionStatus,
              last_webhook_at: new Date().toISOString(),
              tracking_id: rawTrackingId,
              payment_method: 'erip',
              erip_pending: true,
              customer_email: eripCustomerEmail,
              customer_phone: eripCustomerPhone,
            },
          };

          if (transactionUid) {
            const eripResult = await upsertPaymentV2(supabase, eripPendingRow, '[WEBHOOK-LINK-ERIP-PENDING]');
            if (eripResult.action === 'error') {
              console.error('[WEBHOOK-LINK] ERIP pending write error (non-fatal):', eripResult.error);
            }
          }

          // Audit log: ERIP pending stored (SYSTEM ACTOR)
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
            action: 'bepaid.erip.pending_stored',
            created_at: new Date().toISOString(),
            meta: {
              order_id: linkOrderV2.id,
              transaction_uid: transactionUid,
              bepaid_status: transactionStatus,
              payment_method: 'erip',
            },
          });

          await recordWebhookEvent(supabase, {
            provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
            tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
            outcome: 'erip_pending_stored', http_status: 200,
            processing_ms: Date.now() - startTime,
          });
          // STRICT: do NOT create deal, do NOT update order, do NOT grant access
          return new Response(JSON.stringify({ ok: true, status: 'erip_pending_stored' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Non-ERIP or non-pending: existing behavior (status='failed')
        // STOP-GUARD: don't overwrite paid/refunded/canceled orders with 'failed'
        if ((transactionStatus === 'failed' || transactionStatus === 'expired') &&
            !['paid', 'refunded', 'canceled'].includes(linkOrderV2.status)) {
          await supabase.from('orders_v2').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', linkOrderV2.id);
          // CRM routing — Layer A: применить closed_lost
          try { await applyCrmStageOnTerminal(supabase, linkOrderV2.id, 'failed', 'webhook_link_failed'); }
          catch (e) { console.error('[WEBHOOK-LINK] crm-routing apply failed:', e); }
        }

        // === RECORD FAILED PAYMENT in payments_v2 ===
        const failedAmount = transaction?.amount ? transaction.amount / 100 : 0;
        const failedCurrency = transaction?.currency || 'BYN';
        const failedCardHolder = transaction?.credit_card?.holder || null;
        const failedCardLast4 = transaction?.credit_card?.last_4 || null;
        const failedCardBrand = transaction?.credit_card?.brand || null;
        const failedCustomerEmail = transaction?.customer?.email || linkOrderV2?.customer_email || null;
        const failedCustomerPhone = transaction?.customer?.phone || linkOrderV2?.customer_phone || null;
        const failedTxMessage = transaction?.message || transactionStatus || null;

        const failedPaymentRow = {
          order_id: linkOrderV2.id,
          user_id: linkOrderV2.user_id || null,
          profile_id: linkOrderV2.profile_id || null,
          amount: failedAmount,
          currency: failedCurrency,
          status: 'failed',
          provider: 'bepaid',
          provider_payment_id: transactionUid,
          card_holder: failedCardHolder,
          card_last4: failedCardLast4,
          card_brand: failedCardBrand,
          error_message: failedTxMessage,
          origin: 'bepaid',
          meta: {
            payer_name: failedCardHolder,
            customer_email: failedCustomerEmail,
            customer_phone: failedCustomerPhone,
            bepaid_status: transactionStatus,
            last_bepaid_status: transactionStatus,
            last_webhook_at: new Date().toISOString(),
            tracking_id: rawTrackingId,
          },
        };

        // Use helper for idempotent upsert
        if (transactionUid) {
          const linkFailedResult = await upsertPaymentV2(supabase, failedPaymentRow, '[WEBHOOK-LINK-FAILED]');
          if (linkFailedResult.action === 'error') {
            console.error('[WEBHOOK-LINK] Failed payment write error (non-fatal):', linkFailedResult.error);
          }
        } else {
          console.warn('[WEBHOOK-LINK] No transactionUid for failed payment, skipping payments_v2 write');
        }

        // Audit log (error-guarded, SYSTEM ACTOR)
        const { error: auditErr } = await supabase.from('audit_logs').insert({
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'bepaid-webhook',
          action: 'payment_link.failed_recorded',
          created_at: new Date().toISOString(),
          meta: {
            order_id: linkOrderV2.id,
            transaction_uid: transactionUid,
            bepaid_status: transactionStatus,
            payer_name: failedCardHolder,
          },
        });
        if (auditErr) console.error('[WEBHOOK-LINK] Audit log error (non-fatal):', auditErr);

        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'skipped_not_successful', http_status: 200,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: true, status: 'skipped', reason: 'not_successful' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // STOP-GUARD: user_id must exist
      if (!linkOrderV2.user_id) {
        console.error('[WEBHOOK-LINK] STOP-GUARD: user_id is NULL:', parsedOrderId);
        try {
          await supabase.from('payment_reconcile_queue')
            .update({ status: 'pending_needs_mapping', last_error: 'link_order_user_id_null', processed_at: null })
            .eq('bepaid_uid', transactionUid);
        } catch (_) {}
        await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_label: 'bepaid-webhook',
          action: 'payment_link.stop_guard',
          meta: { reason: 'user_id_null', order_id: parsedOrderId, transaction_uid: transactionUid },
        });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'stop_guard_user_id_null', http_status: 202,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: false, status: 'pending_needs_mapping', reason: 'user_id_null' }), {
          status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // STOP-GUARD: profile must exist
      const { data: linkProfile } = await supabase
        .from('profiles')
        .select('id, full_name, email, telegram_username')
        .eq('user_id', linkOrderV2.user_id)
        .maybeSingle();

      if (!linkProfile) {
        console.error('[WEBHOOK-LINK] STOP-GUARD: profile not found:', linkOrderV2.user_id);
        try {
          await supabase.from('payment_reconcile_queue')
            .update({ status: 'pending_needs_mapping', last_error: 'link_profile_not_found', processed_at: null })
            .eq('bepaid_uid', transactionUid);
        } catch (_) {}
        await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_label: 'bepaid-webhook',
          action: 'payment_link.stop_guard',
          meta: { reason: 'profile_not_found', user_id: linkOrderV2.user_id, order_id: parsedOrderId, transaction_uid: transactionUid },
        });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'stop_guard_profile_not_found', http_status: 202,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: false, status: 'pending_needs_mapping', reason: 'profile_not_found' }), {
          status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. Amount
      const linkPaymentAmount = transaction?.amount ? transaction.amount / 100 : Number(linkOrderV2.final_price) || 0;
      if (linkPaymentAmount <= 0) {
        console.error('[WEBHOOK-LINK] Amount=0:', { tx_amount: transaction?.amount, order_final_price: linkOrderV2.final_price });
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'failed_amount_zero', http_status: 500,
          processing_ms: Date.now() - startTime,
        });
        return new Response(JSON.stringify({ ok: false, status: 'failed_amount_zero' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 4. Create payments_v2
      // F12.1 P5: fill-only guard — don't overwrite existing order_id
      const { data: existingLinkPayForP5 } = await supabase
        .from('payments_v2')
        .select('id, order_id')
        .eq('provider', 'bepaid')
        .eq('provider_payment_id', transactionUid)
        .maybeSingle();

      const linkP5OrderId = (existingLinkPayForP5?.order_id) ? existingLinkPayForP5.order_id : linkOrderV2.id;

      const linkPaymentPayload = {
        order_id: linkP5OrderId,
        user_id: linkOrderV2.user_id,
        profile_id: linkProfile.id,
        amount: linkPaymentAmount,
        currency: transaction?.currency || 'BYN',
        status: 'succeeded',
        provider: 'bepaid',
        provider_payment_id: transactionUid,
        card_brand: transaction?.credit_card?.brand || null,
        card_last4: transaction?.credit_card?.last_4 || null,
        paid_at: transaction?.paid_at || new Date().toISOString(),
        is_recurring: false,
        origin: 'payment_link',
        provider_response: { transaction_uid: transactionUid, status: transactionStatus, amount: transaction?.amount, currency: transaction?.currency, paid_at: transaction?.paid_at },
        meta: { source: 'link_payment_webhook', tracking_id: rawTrackingId, bepaid_description: extractBepaidDescription(body), last_bepaid_status: transactionStatus, last_webhook_at: new Date().toISOString(), payment_method: paymentMethod },
        receipt_url: transaction?.receipt_url || null,
      };

      // transactionUid guard (already validated at entry, but belt-and-suspenders)
      if (!transactionUid) {
        console.error('[WEBHOOK-LINK] SKIP payments_v2: no transactionUid');
        return new Response(JSON.stringify({ ok: false, status: 'skipped_no_uid' }), {
          status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const linkPayResult = await upsertPaymentV2(supabase, linkPaymentPayload, '[WEBHOOK-LINK]');

      if (linkPayResult.action === 'error') {
        console.error('[WEBHOOK-LINK] payments_v2 write FAILED:', linkPayResult.error);
        const { error: auditE } = await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_user_id: null, actor_label: 'bepaid-webhook',
          action: 'bepaid.webhook.payments_v2_write_failed',
          created_at: new Date().toISOString(),
          meta: { order_id: linkOrderV2.id, transaction_uid: transactionUid, error: linkPayResult.error },
        });
        if (auditE) console.error('[WEBHOOK-LINK] audit error (non-fatal):', auditE);
        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
          tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
          outcome: 'failed_payments_v2_write', http_status: 500,
          processing_ms: Date.now() - startTime, error_message: linkPayResult.error,
        });
        return new Response(JSON.stringify({ ok: false, status: 'failed_payments_v2_write' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[WEBHOOK-LINK] payments_v2', linkPayResult.action, linkPayResult.id);


      // 5. Update orders_v2 → paid
      const linkOrderMeta = (linkOrderV2.meta && typeof linkOrderV2.meta === 'object') ? linkOrderV2.meta : {};
      await supabase.from('orders_v2').update({
        status: 'paid',
        paid_amount: linkPaymentAmount,
        meta: { ...linkOrderMeta, bepaid_transaction_uid: transactionUid,
          // PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL
          ...( !linkOrderMeta?.payment_flow ? { payment_flow: 'bepaid_link_payment' } : {} ),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', linkOrderV2.id);
      console.log('[WEBHOOK-LINK] Order updated to paid:', linkOrderV2.id);
      // CRM routing — Layer A: применить closed_won (если есть snapshot и не было manual override)
      try { await applyCrmStageOnTerminal(supabase, linkOrderV2.id, 'success', 'webhook_link_paid'); }
      catch (e) { console.error('[WEBHOOK-LINK] crm-routing apply failed:', e); }

      // PATCH-PUBLIC-LINK-COUNTER: idempotently consume payment_links slot for one_time link orders
      try {
        const consumed = await consumePaymentLinkForOrder(supabase, linkOrderV2.id, 'bepaid-webhook[link]');
        console.log('[WEBHOOK-LINK] payment_link consume result:', consumed);
      } catch (e) {
        console.error('[WEBHOOK-LINK] payment_link consume failed (non-fatal):', e);
      }

      // 6. Upsert card_profile_links (stamp) with conflict guard
      const linkCardStamp = transaction?.credit_card?.stamp || null;
      const linkCardLast4 = transaction?.credit_card?.last_4 || null;
      const linkCardBrand = (transaction?.credit_card?.brand || '').toLowerCase().trim() || null;
      if (linkCardStamp && linkProfile.id) {
        const { data: existingStampLink } = await supabase
          .from('card_profile_links')
          .select('profile_id')
          .eq('provider', 'bepaid')
          .eq('provider_token', linkCardStamp)
          .maybeSingle();

        if (existingStampLink && existingStampLink.profile_id !== linkProfile.id) {
          console.warn('[WEBHOOK-LINK] Stamp conflict:', { existing: existingStampLink.profile_id, current: linkProfile.id });
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_label: 'bepaid-webhook',
            action: 'card_stamp.conflict',
            meta: { stamp: linkCardStamp, existing_profile_id: existingStampLink.profile_id, new_profile_id: linkProfile.id, transaction_uid: transactionUid },
          });
        } else {
          await supabase.from('card_profile_links').upsert({
            provider: 'bepaid', provider_token: linkCardStamp,
            card_last4: linkCardLast4 || '', card_brand: linkCardBrand || '',
            profile_id: linkProfile.id, source: 'webhook_link', linked_at: new Date().toISOString(),
          }, { onConflict: 'provider,provider_token' });
        }
      }

      // 7. Grant access
      try {
        const grantResp = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/grant-access-for-order`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({ orderId: linkOrderV2.id }),
          }
        );
        const grantResult = await grantResp.json();
        console.log('[WEBHOOK-LINK] grant-access result:', grantResp.status, grantResult);
        if (!grantResp.ok) {
          await supabase.from('audit_logs').insert({
            actor_type: 'system', actor_label: 'bepaid-webhook',
            action: 'bepaid.webhook.grant_access_failed',
            meta: { order_id: linkOrderV2.id, http_status: grantResp.status, error: grantResult?.error || grantResult, severity: 'CRITICAL' },
          });
        }
      } catch (grantErr) {
        console.error('[WEBHOOK-LINK] grant-access error (non-fatal):', grantErr);
      }

      // 8. Admin notification - lookup product/tariff names
      let linkV2ProductName: string | undefined;
      let linkV2TariffName: string | undefined;
      if (linkOrderV2.product_id) {
        const { data: lp2 } = await supabase.from('products_v2').select('name').eq('id', linkOrderV2.product_id).maybeSingle();
        linkV2ProductName = lp2?.name || undefined;
      }
      if (linkOrderV2.tariff_id) {
        const { data: lt2 } = await supabase.from('tariffs').select('name').eq('id', linkOrderV2.tariff_id).maybeSingle();
        linkV2TariffName = lt2?.name || undefined;
      }
      try {
        await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-notify-admins`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
            body: JSON.stringify({
              message: buildAdminNotifyMessage({
                operation_type: 'link_payment',
                client_name: linkProfile.full_name,
                email: linkProfile.email || linkOrderV2.customer_email,
                product_name: linkV2ProductName,
                tariff_name: linkV2TariffName,
                amount: linkPaymentAmount,
                currency: 'BYN',
                source_label: 'Оплата по ссылке bePaid',
              }),
              source: 'bepaid_link_webhook', order_id: linkOrderV2.id,
            }),
          }
        );
      } catch (notifyErr) {
        console.error('[WEBHOOK-LINK] Notification error (non-fatal):', notifyErr);
      }

      // 9. Update payment_reconcile_queue → materialized
      try {
        await supabase.from('payment_reconcile_queue')
          .update({ status: 'materialized', processed_at: new Date().toISOString(), last_error: null })
          .eq('bepaid_uid', transactionUid);
      } catch (_) {}

      // 10. Audit log
      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'payment_link.materialized',
        meta: {
          order_id: linkOrderV2.id, order_number: linkOrderV2.order_number,
          transaction_uid: transactionUid, profile_id: linkProfile.id,
          amount: linkPaymentAmount, currency: transaction?.currency || 'BYN',
          tracking_id: rawTrackingId,
        },
      });

      await recordWebhookEvent(supabase, {
        provider: 'bepaid', event_type: 'payment_link', transaction_uid: transactionUid,
        tracking_id: rawTrackingId, parsed_kind: effectiveKind, parsed_order_id: parsedOrderId,
        outcome: 'processed', http_status: 200,
        processing_ms: Date.now() - startTime,
      });
      return new Response(JSON.stringify({ ok: true, status: 'processed', order_id: linkOrderV2.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // =====================================================================
    // End of PATCH-LINK-LEGACY handler
    // =====================================================================

    // ---------------------------------------------------------------------
    // V2 direct-charge support
    // In direct-charge we send tracking_id = payments_v2.id (UUID).
    // This block finalizes orders_v2/payments_v2/subscriptions_v2 for 3DS flows.
    // ---------------------------------------------------------------------
    let paymentV2: any = null;
    if (orderId) {
      // First try: search by payments_v2.id (direct-charge tracking_id = payment UUID)
      const { data: p2, error: p2Err } = await supabase
        .from('payments_v2')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (!p2Err && p2) {
        paymentV2 = p2;
      } else {
        // Fallback: search by order_id (link: tracking_id = order UUID)
        const { data: p2ByOrder, error: p2ByOrderErr } = await supabase
          .from('payments_v2')
          .select('*')
          .eq('order_id', orderId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!p2ByOrderErr && p2ByOrder) paymentV2 = p2ByOrder;
      }
    }

    // B3: IDEMPOTENCY GUARD (main branch) — early exit if this transactionUid already processed
    if (transactionUid) {
      const { data: existingPmtByUid } = await supabase
        .from('payments_v2')
        .select('id, order_id')
        .eq('provider_payment_id', transactionUid)
        .eq('provider', 'bepaid')
        .maybeSingle();

      if (existingPmtByUid) {
        console.log('[WEBHOOK] Already processed (idempotency, main branch):', transactionUid);
        return new Response(JSON.stringify({ ok: true, status: 'already_processed', payment_id: existingPmtByUid.id }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
          } else {
            // B6: createOrderFromWebhook returned null (trial blocked, duplicate, or skipped)
            console.log('[WEBHOOK] createOrderFromWebhook returned null — skipped');
            return new Response(JSON.stringify({ ok: true, status: 'skipped', reason: 'order_creation_skipped' }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (createErr) {
          console.error('[WEBHOOK] Failed to create orphan order:', createErr);
          
          // P3.0.1: Queue for manual review with observability
          const { data: fallbackQueueRow, error: fallbackQueueErr } = await supabase.from('payment_reconcile_queue').insert({
            bepaid_uid: transactionUid,
            tracking_id: rawTrackingId,
            amount: transaction.amount / 100,
            currency: transaction.currency || 'BYN',
            customer_email: transaction.customer?.email,
            raw_payload: body,
            source: 'webhook_orphan',
            status: 'pending',
            last_error: `Failed to create order: ${String(createErr)}`,
          })
            .select('id, source, bepaid_uid')
            .maybeSingle();
          
          if (fallbackQueueErr) {
            console.error('[WEBHOOK-QUEUE-FALLBACK] DB error:', JSON.stringify({ code: fallbackQueueErr.code, message: fallbackQueueErr.message }));
          } else if (!fallbackQueueRow) {
            console.error('[WEBHOOK-QUEUE-FALLBACK] No row returned:', { bepaid_uid: transactionUid });
          } else {
            console.log(`[WEBHOOK-QUEUE-FALLBACK] OK id=${fallbackQueueRow.id} source=${fallbackQueueRow.source} uid=${fallbackQueueRow.bepaid_uid}`);
          }
          
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
        // F12 P4: fill-only — prioritize existing value, never overwrite
        provider_payment_id: paymentV2.provider_payment_id || transactionUid || null,
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
      // REFUND HANDLING — PATCH DEAL-LINKAGE-ROOT-FIXES-2026-05
      // Канонический write-path для refund-row + parent linkage + atomic update
      // через SECURITY DEFINER RPC `record_refund_atomic`. RPC обеспечивает:
      //   - идемпотентность по provider_payment_id (refund uid);
      //   - вставку отдельной refund-row с meta.parent_payment_id / parent_payment_uid;
      //   - атомарный апдейт parent.refunded_amount;
      //   - пересчёт order.status (refunded при full refund) и order.meta агрегатов.
      // Старый путь (мутация payments_v2.refunds JSON-массива) был заменён,
      // так как не создавал refund-row → DealDetailSheet не показывал «Возврат»
      // (дефект Ларисы).
      // =====================================================================
      if (isRefundTransaction && transactionUid) {
        console.log(`[bepaid-webhook] refund via record_refund_atomic: uid=${transactionUid}, parent=${paymentV2.id}`);

        const refundAmount = (transaction?.amount || 0) / 100;
        const refundReason = transaction?.message
          || transaction?.refund_reason
          || body.refund?.reason
          || null;

        // Pre-cap guard: defense-in-depth (RPC сам не cap'ит).
        const parentAmt = Number(paymentV2.amount || 0);
        const priorRefunded = Number(paymentV2.refunded_amount || 0);
        if (parentAmt > 0 && priorRefunded + refundAmount - parentAmt > 0.01) {
          await supabase.from('audit_logs').insert({
            actor_user_id: null,
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            action: 'bepaid_refund_over_cap_blocked',
            meta: {
              payment_id: paymentV2.id,
              order_id: paymentV2.order_id,
              refund_uid: transactionUid,
              parent_amount: parentAmt,
              prior_refunded: priorRefunded,
              attempted_refund: refundAmount,
              reason: 'refund would exceed parent.amount — manual_review',
            },
          });
          // Возвращаем 200 (по правилу Payment Error Handling), DML не выполняется.
          return new Response(
            JSON.stringify({ ok: true, type: 'refund_over_cap_blocked', refund_id: transactionUid, fallback: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Сначала flush basePaymentUpdate (sync от bePaid) на parent.
        try {
          await supabase
            .from('payments_v2')
            .update(basePaymentUpdate)
            .eq('id', paymentV2.id);
        } catch (syncErr) {
          console.error('[bepaid-webhook] basePaymentUpdate flush failed (non-fatal):', syncErr);
        }

        const { data: rpcResult, error: rpcErr } = await supabase.rpc('record_refund_atomic', {
          p_order_id: paymentV2.order_id,
          p_parent_payment_id: paymentV2.id,
          p_refund_amount: refundAmount,
          p_refund_uid: transactionUid,
          p_refund_reason: refundReason,
          p_actor_user_id: null,
          p_target_user_id: paymentV2.user_id || null,
          p_bepaid_response: body || {},
        });

        if (rpcErr) {
          console.error('[bepaid-webhook] record_refund_atomic failed:', rpcErr);
          await supabase.from('audit_logs').insert({
            actor_user_id: null,
            actor_type: 'system',
            actor_label: 'bepaid-webhook',
            action: 'bepaid_refund_rpc_failed',
            meta: {
              payment_id: paymentV2.id,
              order_id: paymentV2.order_id,
              refund_uid: transactionUid,
              error: rpcErr.message || String(rpcErr),
            },
          });
          // Fallback по правилу Payment Error Handling — 200 + fallback:true.
          return new Response(
            JSON.stringify({ ok: false, type: 'refund_rpc_failed', refund_id: transactionUid, fallback: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const result = (rpcResult as any) || {};
        await supabase.from('audit_logs').insert({
          actor_user_id: null,
          actor_type: 'system',
          actor_label: 'bepaid-webhook',
          action: result.idempotent ? 'bepaid_refund_idempotent' : 'bepaid_refund_recorded',
          meta: {
            payment_id: paymentV2.id,
            order_id: paymentV2.order_id,
            refund_uid: transactionUid,
            refund_amount: refundAmount,
            rpc_result: result,
          },
        });

        return new Response(
          JSON.stringify({
            ok: true,
            type: result.idempotent ? 'refund_idempotent' : 'refund_recorded',
            refund_id: transactionUid,
            amount: refundAmount,
            rpc_result: result,
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
          // F12 P2: fill-only provider_payment_id on order (main branch)
          const mainOrderUpdate: Record<string, any> = {
            status: 'paid',
            paid_amount: paymentV2.amount,
            meta: {
              ...(orderV2.meta || {}),
              bepaid_uid: transactionUid,
              payment_id: paymentV2.id,
              // PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL
              ...( !(orderV2.meta as any)?.payment_flow ? { payment_flow: 'bepaid_one_time_payment' } : {} ),
            },
          };
          // Fill-only: set provider_payment_id only if NULL
          if (!orderV2.provider_payment_id && transactionUid) {
            mainOrderUpdate.provider_payment_id = transactionUid;
          }
          await supabase
            .from('orders_v2')
            .update(mainOrderUpdate)
            .eq('id', orderV2.id);

          // CRM routing — Layer A: применить closed_won (one-time main success branch)
          try { await applyCrmStageOnTerminal(supabase, orderV2.id, 'success', 'webhook_first_payment_paid'); }
          catch (e) { console.error('[WEBHOOK] crm-routing apply failed:', e); }

          // F12 P7: Audit log for fill operation (main branch)
          if (!orderV2.provider_payment_id && transactionUid) {
            await supabase.from('audit_logs').insert({
              actor_user_id: null,
              actor_type: 'system',
              actor_label: 'F12_ord_link',
              action: 'order.fill_provider_payment_id',
              meta: { order_id: orderV2.id, provider_payment_id: transactionUid, source: 'main_branch_webhook' },
            });
          }

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
            .select('requires_card_tokenization, auto_charge_after_trial, getcourse_offer_id, payment_method, installment_count, meta')
            .eq('tariff_id', orderV2.tariff_id)
            .eq('offer_type', offerType)
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .limit(1)
            .maybeSingle();

          // PATCH PRODUCT-TYPE-SOT (2026-04-28):
          // Source of truth для типа продукта — tariff_offers.meta.recurring.is_recurring
          // (UI-чекбокс «Подписка (автопродление)»). Installment тоже recurring по природе.
          // Trial всегда создаёт subscriptions_v2 (это и есть подписка на пробный период).
          // requires_card_tokenization больше НЕ используется как классификатор.
          const offerIsInstallment = offer?.payment_method === 'internal_installment' && (offer?.installment_count ?? 0) > 1;
          const offerMetaRecurring = !!(offer?.meta?.recurring?.is_recurring);
          const autoChargeAfterTrial = offer?.auto_charge_after_trial ?? true;
          const isRecurringSubscription = offerMetaRecurring || offerIsInstallment || (offerType === 'trial' && autoChargeAfterTrial);

          if (productV2 && tariff) {
            // PATCH-A1: Guard — do NOT create subscription if order is not paid
            // This prevents creating subscriptions from pending/failed payment attempts
            if (orderV2.status !== 'paid') {
              console.log(`[SUBSCRIPTION] Skipping: order.status=${orderV2.status} (not paid), order_id=${orderV2.id}`);
              await supabase.from('audit_logs').insert({
                actor_type: 'system',
                actor_user_id: null,
                actor_label: 'bepaid-webhook',
                action: 'bepaid.webhook.subscription_skipped_not_paid',
                meta: {
                  order_id: orderV2.id,
                  order_status: orderV2.status,
                  bepaid_uid: transactionUid,
                  reason: 'Order status is not paid - subscription creation skipped',
                },
              });
              // Continue to handle other operations (GetCourse, Telegram), but skip subscription creation
            }

            // ----------------------------------------------------------------
            // PATCH H2.1b-ii: 3DS finalize handover to canonical writer.
            // All access writes (subscriptions_v2 access fields, entitlements,
            // entitlement_orders, telegram-grant-access) are owned by
            // grant-access-for-order(context='3ds_finalize'). This webhook only
            // performs provider-sync on the subscription_id returned by writer
            // (billing_type, next_charge_at, auto_renew, meta.bepaid_*, updated_at,
            // optional payment_method_id/payment_token).
            //
            // skip/error/manual_review/ambiguous_order_id outcomes → audit
            // 'bepaid.webhook.grant_skipped_no_fallback' + HTTP 200, NO fallback-write.
            // ----------------------------------------------------------------

            // Profile lookup is still needed downstream (GetCourse + admin notify).
            const { data: userProfileCheck } = await supabase
              .from('profiles')
              .select('id, user_id, email, telegram_user_id, telegram_link_status, phone, first_name, last_name')
              .eq('user_id', orderV2.user_id)
              .maybeSingle();

            let grantedSubscriptionId: string | null = null;
            let grantNextChargeAt: string | null = null;
            let grantOutcomeKind = 'not_called';
            let grantOutcomeFull: any = null;

            if (orderV2.status === 'paid' && orderV2.id) {
              try {
                const grantResp = await fetch(
                  `${Deno.env.get('SUPABASE_URL')}/functions/v1/grant-access-for-order`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                    },
                    body: JSON.stringify({
                      orderId: orderV2.id,
                      context: '3ds_finalize',
                      source: 'bepaid_webhook',
                    }),
                  },
                );
                const grantBody = await grantResp.json().catch(() => ({}));
                grantOutcomeFull = grantBody?.outcome || null;
                grantOutcomeKind = String(grantOutcomeFull?.kind || 'unknown');
                const successKinds = [
                  'ok',
                  'extended',
                  'bootstrap_created',
                  'incomplete_subscription_completed',
                  'skip_already_processed',
                ];
                if (successKinds.includes(grantOutcomeKind)) {
                  grantedSubscriptionId = grantOutcomeFull?.subscription_id ?? null;
                  grantNextChargeAt = grantOutcomeFull?.next_charge_at_suggested ?? null;
                } else {
                  // skip_no_order / skip_inactive_offer / skip_concurrent_insert
                  // / manual_review_* / error / ambiguous_order_id → NO fallback-write.
                  await supabase.from('audit_logs').insert({
                    actor_type: 'system',
                    actor_user_id: null,
                    actor_label: 'bepaid-webhook',
                    action: 'bepaid.webhook.grant_skipped_no_fallback',
                    meta: {
                      order_id: orderV2.id,
                      bepaid_uid: transactionUid,
                      context: '3ds_finalize',
                      outcome_kind: grantOutcomeKind,
                      outcome: grantOutcomeFull,
                    },
                  });
                }
              } catch (grantErr) {
                grantOutcomeKind = 'invoke_error';
                await supabase.from('audit_logs').insert({
                  actor_type: 'system',
                  actor_user_id: null,
                  actor_label: 'bepaid-webhook',
                  action: 'bepaid.webhook.grant_skipped_no_fallback',
                  meta: {
                    order_id: orderV2.id,
                    bepaid_uid: transactionUid,
                    context: '3ds_finalize',
                    outcome_kind: 'invoke_error',
                    error: String((grantErr as Error)?.message || grantErr),
                  },
                });
              }
            }

            // Provider-sync: only on subscription_id returned by writer,
            // only technical/provider fields (no access_*/status writes).
            if (grantedSubscriptionId) {
              const providerSyncPatch: Record<string, any> = {
                billing_type: isRecurringSubscription ? 'mit' : 'cit',
                auto_renew: !!isRecurringSubscription,
                updated_at: now.toISOString(),
              };
              if (grantNextChargeAt) providerSyncPatch.next_charge_at = grantNextChargeAt;
              if (paymentMethodId) {
                providerSyncPatch.payment_method_id = paymentMethodId;
                providerSyncPatch.payment_token = paymentV2.payment_token;
              }
              const { data: curSub } = await supabase
                .from('subscriptions_v2')
                .select('meta')
                .eq('id', grantedSubscriptionId)
                .maybeSingle();
              const baseMeta = (curSub?.meta as Record<string, any>) || {};
              providerSyncPatch.meta = {
                ...baseMeta,
                bepaid_uid: transactionUid,
                bepaid_synced_at: now.toISOString(),
                bepaid_outcome: grantOutcomeKind,
              };
              await supabase
                .from('subscriptions_v2')
                .update(providerSyncPatch)
                .eq('id', grantedSubscriptionId);
            }

            // PATCH H2.1b-ii: entitlements + entitlement_orders are owned by
            // grant-access-for-order(context='3ds_finalize'). Block removed here —
            // see provider-sync block above.

            // Reuse profile data for downstream GetCourse sync & admin notify.
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

            // PATCH H2.1b-ii: Telegram grant is owned by grant-access-for-order
            // (canonical write-path → telegram-grant-access). Webhook no longer
            // calls telegram-grant-access directly here.

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
              .select('full_name, email, telegram_username')
              .eq('user_id', notifyOrderData.user_id)
              .single();

            const notifyMessage = buildAdminNotifyMessage({
              operation_type: notifyOrderData.is_trial ? 'trial' : 'payment',
              client_name: customerProfile?.full_name,
              email: customerProfile?.email || notifyOrderData.customer_email,
              telegram_username: customerProfile?.telegram_username,
              product_name: (notifyOrderData.products_v2 as any)?.name,
              tariff_name: (notifyOrderData.tariffs as any)?.name,
              amount: paymentV2.amount,
              currency: paymentV2.currency,
              source_label: 'Оплата через checkout bePaid',
            });

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
        // CRM routing — Layer A: применить closed_lost для первичной оплаты
        try { await applyCrmStageOnTerminal(supabase, paymentV2.order_id, 'failed', 'webhook_first_payment_failed'); }
        catch (e) { console.error('[WEBHOOK] crm-routing apply failed:', e); }

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

    // =====================================================================
    // PATCH P-LEGACY-BEPAID.1: Handle successful payments WITHOUT tracking_id
    // Matches by card.stamp / email → materialize in payments_v2 + amoCRM
    // =====================================================================
    if (!orderId && !subscriptionId && transactionStatus === 'successful' && transactionUid) {
      console.log('[WEBHOOK-LEGACY] No tracking_id/subscriptionId, attempting legacy matching for uid=' + transactionUid);

      // 1. Extract anchors
      const cardStamp = transaction?.credit_card?.stamp || null;
      const cardLast4 = transaction?.credit_card?.last_4 || null;
      const cardBrand = (transaction?.credit_card?.brand || '').toLowerCase().trim() || null;
      const cardHolder = transaction?.credit_card?.holder || null;
      const customerEmail = (transaction?.customer?.email || body?.customer?.email || '')?.toLowerCase().trim() || null;
      const customerPhone = transaction?.customer?.phone || body?.customer?.phone || null;
      const receiptText = transaction?.receipt_text || transaction?.description || body?.description || null;

      // 1b. Try to extract subscription UID from nested paths
      const extractedSubUid = transaction?.subscription?.uid || transaction?.subscription?.id
        || body?.subscription?.uid || body?.subscription?.id
        || transaction?.additional_data?.subscription_id || null;

      // 2. Amount: always /100 (bePaid sends in kopecks)
      const legacyAmount = transaction?.amount ? transaction.amount / 100 : 0;
      const legacyCurrency = transaction?.currency || 'BYN';

      // 3. Match profile
      let profileId: string | null = null;
      let matchMethod = 'none';

      // 3a. By card.stamp → card_profile_links
      if (!profileId && cardStamp) {
        const { data: stampLink } = await supabase
          .from('card_profile_links')
          .select('profile_id')
          .eq('provider', 'bepaid')
          .eq('provider_token', cardStamp)
          .limit(1)
          .maybeSingle();
        if (stampLink?.profile_id) { profileId = stampLink.profile_id; matchMethod = 'card_stamp'; }
      }

      // 3b. By card_last4 + card_brand → card_profile_links (fallback)
      if (!profileId && cardLast4 && cardBrand) {
        const { data: cardLink } = await supabase
          .from('card_profile_links')
          .select('profile_id')
          .eq('card_last4', cardLast4)
          .eq('card_brand', cardBrand)
          .eq('provider', 'bepaid')
          .limit(1)
          .maybeSingle();
        if (cardLink?.profile_id) { profileId = cardLink.profile_id; matchMethod = 'card_last4_brand'; }
      }

      // 3c. By email → profiles
      if (!profileId && customerEmail && customerEmail.includes('@')) {
        const { data: emailProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', customerEmail)
          .limit(1)
          .maybeSingle();
        if (emailProfile?.id) { profileId = emailProfile.id; matchMethod = 'email'; }
      }

      // 3d. Try extracted subscription UID → provider_subscriptions → subscription_v2 → user
      if (!profileId && extractedSubUid) {
        const { data: provSubRaw } = await supabase
          .from('provider_subscriptions')
          .select('subscription_v2_id, subscriptions_v2(user_id)')
          .eq('provider_subscription_id', String(extractedSubUid))
          .maybeSingle();
        const provSub = provSubRaw as any;
        const subsV2 = Array.isArray(provSub?.subscriptions_v2) ? provSub?.subscriptions_v2[0] : provSub?.subscriptions_v2;
        if (subsV2?.user_id) {
          const { data: subProfile } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', subsV2.user_id)
            .maybeSingle();
          if ((subProfile as any)?.id) { profileId = (subProfile as any).id; matchMethod = 'subscription_uid'; }
        }
      }

      console.log(`[WEBHOOK-LEGACY] Match result: profile_id=${profileId}, method=${matchMethod}, stamp=${cardStamp ? 'yes' : 'no'}, email=${customerEmail}`);

      if (profileId) {
        // ===== MATCHED: materialize =====

        // 4a. Upsert card_profile_links (only if stamp is present)
        if (cardStamp && cardLast4) {
          try {
            await supabase.from('card_profile_links').upsert({
              provider: 'bepaid',
              provider_token: cardStamp,
              card_last4: cardLast4,
              card_brand: cardBrand || null,
              card_holder: cardHolder || null,
              profile_id: profileId,
              source: 'webhook_legacy',
              linked_at: new Date().toISOString(),
            }, { onConflict: 'provider,provider_token' });
          } catch (linkErr) {
            console.error('[WEBHOOK-LEGACY] card_profile_links upsert error:', linkErr);
          }
        }

        // 4b. Idempotency check: payments_v2 by provider_payment_id
        const { data: existingPmt } = await supabase
          .from('payments_v2')
          .select('id')
          .eq('provider_payment_id', transactionUid)
          .eq('provider', 'bepaid')
          .maybeSingle();

        let paymentCreated = false;
        if (!existingPmt) {
          // Get user_id from profile
          const { data: profileData } = await supabase
            .from('profiles')
            .select('user_id')
            .eq('id', profileId)
            .maybeSingle();

          const paymentPayload = {
            provider: 'bepaid',
            provider_payment_id: transactionUid,
            profile_id: profileId,
            user_id: profileData?.user_id || null,
            amount: legacyAmount,
            currency: legacyCurrency,
            status: 'succeeded' as const,
            origin: 'legacy_subscription',
            is_recurring: true,
            card_last4: cardLast4,
            card_brand: cardBrand,
            card_holder: cardHolder,
            paid_at: transaction?.paid_at || new Date().toISOString(),
            receipt_url: transaction?.receipt_url || null,
            product_name_raw: receiptText || null,
            provider_response: {
              transaction_uid: transactionUid,
              status: transactionStatus,
              amount: transaction?.amount,
              currency: legacyCurrency,
              paid_at: transaction?.paid_at,
            },
            meta: {
              legacy: true,
              match_method: matchMethod,
              card_stamp: cardStamp,
              customer_email: customerEmail,
              customer_phone: customerPhone,
              receipt: receiptText,
              extracted_sub_uid: extractedSubUid,
              bepaid_description: receiptText || extractBepaidDescription(body),
            },
          };

          const legacyUpsertResult = await upsertPaymentV2(supabase, paymentPayload, '[WEBHOOK-LEGACY]');
          if (legacyUpsertResult.action === 'error') {
            console.error('[WEBHOOK-LEGACY] payments_v2 write error:', legacyUpsertResult.error);
          } else {
            paymentCreated = legacyUpsertResult.action === 'created';
          }
        } else {
          console.log('[WEBHOOK-LEGACY] payments_v2 already exists for uid=' + transactionUid);
        }

        // 4c. amoCRM contact + deal
        let amoContactId: number | null = null;
        let amoDealId: number | null = null;
        const amoCreds = await getAmoCRMCreds(supabase);
        if (amoCreds && customerEmail) {
          const contactName = cardHolder || customerEmail.split('@')[0] || 'Клиент';
          amoContactId = await createAmoCRMContact(supabase, amoCreds, contactName, customerEmail, customerPhone || undefined);
          amoDealId = await createAmoCRMDeal(supabase, amoCreds,
            `Продление: ${receiptText || 'Подписка'}`,
            legacyAmount,
            amoContactId,
            { transaction_uid: transactionUid, legacy: true },
          );
        }

        // 4d. Update queue status
        await supabase.from('payment_reconcile_queue')
          .update({ status: 'materialized', processed_at: new Date().toISOString() })
          .eq('bepaid_uid', transactionUid);

        // 4e. Audit log
        await supabase.from('audit_logs').insert({
          actor_type: 'system', actor_label: 'bepaid-webhook',
          action: 'legacy_payment.materialized',
          meta: {
            transaction_uid: transactionUid, profile_id: profileId,
            match_method: matchMethod, amount: legacyAmount,
            card_last4: cardLast4, email: customerEmail,
            payment_created: paymentCreated,
            amocrm_contact_id: amoContactId, amocrm_deal_id: amoDealId,
          },
        });

        await recordWebhookEvent(supabase, {
          provider: 'bepaid', event_type: body?.event || body?.type || 'legacy_payment',
          transaction_uid: transactionUid, subscription_id: extractedSubUid ? String(extractedSubUid) : null,
          tracking_id: rawTrackingId, parsed_kind: 'legacy', parsed_order_id: null,
          outcome: 'legacy_matched', http_status: 200,
          processing_ms: Date.now() - startTime,
        });

        console.log(`[WEBHOOK-LEGACY] SUCCESS: materialized uid=${transactionUid}, profile=${profileId}, method=${matchMethod}, amo_contact=${amoContactId}, amo_deal=${amoDealId}`);

        return new Response(JSON.stringify({
          ok: true, mode: 'legacy_matched', match_method: matchMethod,
          profile_id: profileId, payment_created: paymentCreated,
          amocrm_contact_id: amoContactId, amocrm_deal_id: amoDealId,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ===== NOT MATCHED: leave in queue for manual mapping =====
      await supabase.from('payment_reconcile_queue')
        .update({ status: 'pending_needs_mapping' })
        .eq('bepaid_uid', transactionUid);

      await supabase.from('audit_logs').insert({
        actor_type: 'system', actor_label: 'bepaid-webhook',
        action: 'legacy_payment.unmatched',
        meta: {
          transaction_uid: transactionUid, card_stamp: cardStamp,
          card_last4: cardLast4, email: customerEmail, receipt: receiptText,
          extracted_sub_uid: extractedSubUid,
        },
      });

      await recordWebhookEvent(supabase, {
        provider: 'bepaid', event_type: body?.event || body?.type || 'legacy_payment',
        transaction_uid: transactionUid, subscription_id: extractedSubUid ? String(extractedSubUid) : null,
        tracking_id: rawTrackingId, parsed_kind: 'legacy', parsed_order_id: null,
        outcome: 'legacy_unmatched', http_status: 202,
        processing_ms: Date.now() - startTime,
      });

      console.log(`[WEBHOOK-LEGACY] UNMATCHED: uid=${transactionUid}, stamp=${cardStamp ? 'yes' : 'no'}, email=${customerEmail}`);

      return new Response(JSON.stringify({
        ok: true, mode: 'legacy_unmatched', needs_mapping: true,
        transaction_uid: transactionUid,
      }), {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // =====================================================================
    // END PATCH P-LEGACY-BEPAID.1
    // =====================================================================

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
    // =====================================================================
    // PATCH H2.1c-i: legacy one-time access-write path RETIRED
    // ---------------------------------------------------------------------
    // History: до H2.1c-i этот блок выдавал доступ напрямую (subscriptions_v2
    // insert/update, entitlements upsert, legacy subscriptions update,
    // telegram-grant-access invoke). Analysis (proof: patch_h2_1c_legacy_one_time_analysis_2026_05.md)
    // подтвердил 0 paid за 90 дней через этот путь — 100% live one-time идёт
    // через canonical link_order ветку выше. Любой неожиданно прилетевший
    // legacy payload теперь уходит в manual_review без побочных эффектов.
    // НИКАКИХ access writes / telegram invokes / entitlements upserts в этом
    // блоке быть не должно. См. plan.md → H2.1c-i.
    // =====================================================================
    if (orderStatus === 'completed' && order.user_id) {
      const meta = (order.meta as Record<string, any>) || {};
      try {
        await supabase.from('audit_logs').insert({
          actor_user_id: order.user_id ?? '00000000-0000-0000-0000-000000000000',
          target_user_id: order.user_id ?? null,
          action: 'bepaid.webhook.legacy_one_time_retired_manual_review',
          meta: {
            reason: 'legacy_one_time_path_retired_h2_1c_i',
            transaction_uid: transactionUid ?? null,
            tracking_id: orderId ?? null,
            subscription_id: subscriptionId ?? null,
            legacy_order_id: order.id ?? null,
            legacy_order_number: order.order_number ?? null,
            customer_email: order.customer_email ?? null,
            amount: order.amount ?? null,
            currency: order.currency ?? null,
            product_code: order.products?.code ?? meta.product_code ?? null,
            product_v2_id: meta.product_v2_id ?? null,
            tariff_code: meta.tariff_code ?? null,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditErr) {
        console.error('[WEBHOOK-LEGACY-RETIRED] audit log failed:', auditErr);
      }

      console.log(`[WEBHOOK-LEGACY-RETIRED] zone2 paid payload routed to manual_review: order=${order.id}, tx=${transactionUid}`);

      return new Response(
        JSON.stringify({
          ok: true,
          status: 'manual_review',
          reason: 'legacy_one_time_path_retired',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // PATCH P2.1: Fallthrough guard — if we reached here, something wasn't handled
    // For legacy orders flow this is the normal success return, so only apply fallthrough
    // if no order was processed (paymentV2 and orderId both handled above)
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
  
  // Get offer details + product/tariff for snapshot
  let productId: string | null = null;
  let tariffId: string | null = null;
  let orphanProduct: any = null;
  let orphanTariff: any = null;
  
  if (offerId) {
    const { data: offer } = await supabase
      .from('tariff_offers')
      .select(`
        id,
        tariff_id,
        tariffs!inner (
          id,
          name,
          code,
          public_id,
          access_days,
          product_id,
          products_v2!inner (
            id,
            name,
            code,
            public_id
          )
        )
      `)
      .eq('id', offerId)
      .maybeSingle();

    if (offer) {
      tariffId = offer.tariff_id;
      productId = offer.tariffs?.product_id;
      orphanTariff = offer.tariffs;
      orphanProduct = offer.tariffs?.products_v2;
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

  const orphanAccessDays = orphanTariff?.access_days || 30;
  const orphanNow = new Date();
  const orphanPlannedEnd = new Date(orphanNow);
  orphanPlannedEnd.setDate(orphanPlannedEnd.getDate() + orphanAccessDays);

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
      created_at: transaction.paid_at || now.toISOString(),
      meta: {
        reconstructed_from_webhook: true,
        bepaid_uid: transaction.uid,
        bepaid_subscription_id: bepaidSubscriptionId,
        original_tracking_id: transaction.tracking_id,
        reconstructed_at: now.toISOString(),
        customer_first_name: transaction.customer?.first_name || subscription?.customer?.first_name,
        customer_last_name: transaction.customer?.last_name || subscription?.customer?.last_name,
      },
      purchase_snapshot: buildPurchaseSnapshot({
        product_id: productId,
        product_public_id: orphanProduct?.public_id,
        product_name: orphanProduct?.name,
        product_code: orphanProduct?.code,
        tariff_id: tariffId,
        tariff_public_id: orphanTariff?.public_id,
        tariff_name: orphanTariff?.name,
        tariff_code: orphanTariff?.code,
        offer_id: offerId,
        price: amountBYN,
        currency,
        access_days: orphanAccessDays,
        planned_access_start_at: orphanNow.toISOString(),
        planned_access_end_at: orphanPlannedEnd.toISOString(),
        reconcile_source: 'webhook_orphan',
        extra: {
          bepaid_uid: transaction.uid,
          bepaid_subscription_id: bepaidSubscriptionId,
          reconstructed_from_webhook: true,
        },
      }),
    })
    .select()
    .single();

  if (error) throw error;

  // Create payment record
  // FIX: Resolve profile_id for orphan order reconstruction
  let orphanProfileId: string | null = null;
  if (userId) {
    const { data: profileForPayment } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    orphanProfileId = profileForPayment?.id || null;
  }

  await supabase.from('payments_v2').insert({
    order_id: order.id,
    profile_id: orphanProfileId,  // FIX: Add profile_id
    amount: amountBYN,
    currency: currency,
    provider: 'bepaid',
    provider_payment_id: transaction.uid,
    status: 'succeeded',
    paid_at: transaction.paid_at || now.toISOString(),
    card_brand: transaction.credit_card?.brand,
    card_last4: transaction.credit_card?.last_4,
    // B5: No-PII — sanitised provider_response (no raw payload with card/personal data)
    provider_response: {
      transaction_uid: transaction.uid,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      paid_at: transaction.paid_at,
      tracking_id: transaction.tracking_id,
    },
  });

  // SECURITY: Orphan handler MUST NOT grant access — only create order+payment, mark as orphan
  // Access granting requires manual admin review or a valid order→subscription chain
  if (userId && productId) {
    console.warn('[ORPHAN] Order created but access NOT granted — orphan requires manual review');
    
    // Mark order as orphan/requires_review
    await supabase.from('orders_v2').update({
      meta: {
        ...(order.meta || {}),
        orphan: true,
        requires_review: true,
        orphan_reason: 'created_from_webhook_without_valid_order',
      },
    }).eq('id', order.id);

    // Write to provider_webhook_orphans for admin visibility
    await supabase.from('provider_webhook_orphans').upsert({
      provider: 'bepaid',
      provider_subscription_id: body.id || subscription?.id || null,
      provider_payment_id: transaction.uid,
      reason: 'orphan_order_created_no_access',
      raw_data: createSafeOrphanData(body, transaction.tracking_id),
      processed: false,
    }, { onConflict: 'provider,provider_payment_id', ignoreDuplicates: true });

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'webhook.orphan.access_skipped',
      actor_type: 'system',
      actor_label: 'bepaid-webhook',
      meta: {
        order_id: order.id,
        order_number: order.order_number,
        user_id: userId,
        product_id: productId,
        amount: amountBYN,
        currency,
        bepaid_uid: transaction.uid,
        reason: 'Orphan handler must not auto-grant access — requires manual review',
      },
    });
  }

  // Save card token if available
  const cardToken = transaction.credit_card?.token || subscription?.credit_card?.token;
  if (cardToken && userId) {
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

  console.log(`[WEBHOOK] Created orphan order ${orderNumber} for ${customerEmail}`);
  return order;
}
