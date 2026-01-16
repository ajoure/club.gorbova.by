/**
 * Helper functions for bePaid data extraction and processing
 */

/**
 * Extracts customer email from nested bePaid transaction data
 * Handles various data structures from webhooks, API responses, and CSV imports
 */
export function extractCustomerEmail(data: any): string | null {
  if (!data) return null;
  
  // Direct email field
  if (data.email && typeof data.email === 'string') {
    return normalizeEmail(data.email);
  }
  
  // customer_email field (common in queue)
  if (data.customer_email && typeof data.customer_email === 'string') {
    return normalizeEmail(data.customer_email);
  }
  
  // Nested in transaction.customer
  if (data.transaction?.customer?.email) {
    return normalizeEmail(data.transaction.customer.email);
  }
  
  // Nested in customer object
  if (data.customer?.email) {
    return normalizeEmail(data.customer.email);
  }
  
  // provider_response nested structures
  if (data.provider_response) {
    const pr = data.provider_response;
    if (pr.transaction?.customer?.email) {
      return normalizeEmail(pr.transaction.customer.email);
    }
    if (pr.customer?.email) {
      return normalizeEmail(pr.customer.email);
    }
  }
  
  // raw_data from imports
  if (data.raw_data) {
    const raw = typeof data.raw_data === 'string' ? JSON.parse(data.raw_data) : data.raw_data;
    if (raw.email) return normalizeEmail(raw.email);
    if (raw.customer?.email) return normalizeEmail(raw.customer.email);
    if (raw['E-mail плательщика']) return normalizeEmail(raw['E-mail плательщика']);
    if (raw['Email']) return normalizeEmail(raw['Email']);
  }
  
  // CSV column names (Russian)
  if (data['E-mail плательщика']) {
    return normalizeEmail(data['E-mail плательщика']);
  }
  if (data['Email']) {
    return normalizeEmail(data['Email']);
  }
  if (data['Электронная почта']) {
    return normalizeEmail(data['Электронная почта']);
  }
  
  return null;
}

/**
 * Extracts customer phone from nested bePaid transaction data
 */
export function extractCustomerPhone(data: any): string | null {
  if (!data) return null;
  
  // Direct phone field
  if (data.phone && typeof data.phone === 'string') {
    return normalizePhone(data.phone);
  }
  
  // customer_phone field
  if (data.customer_phone && typeof data.customer_phone === 'string') {
    return normalizePhone(data.customer_phone);
  }
  
  // Nested in transaction.customer
  if (data.transaction?.customer?.phone) {
    return normalizePhone(data.transaction.customer.phone);
  }
  
  // Nested in customer object
  if (data.customer?.phone) {
    return normalizePhone(data.customer.phone);
  }
  
  // provider_response nested structures
  if (data.provider_response) {
    const pr = data.provider_response;
    if (pr.transaction?.customer?.phone) {
      return normalizePhone(pr.transaction.customer.phone);
    }
    if (pr.customer?.phone) {
      return normalizePhone(pr.customer.phone);
    }
  }
  
  // CSV column names (Russian)
  if (data['Телефон плательщика']) {
    return normalizePhone(data['Телефон плательщика']);
  }
  if (data['Телефон']) {
    return normalizePhone(data['Телефон']);
  }
  
  return null;
}

/**
 * Extracts card holder name from nested bePaid data
 */
export function extractCardHolder(data: any): string | null {
  if (!data) return null;
  
  // Direct field
  if (data.card_holder) return data.card_holder;
  
  // Nested in credit_card
  if (data.credit_card?.holder) return data.credit_card.holder;
  if (data.transaction?.credit_card?.holder) return data.transaction.credit_card.holder;
  
  // provider_response
  if (data.provider_response?.transaction?.credit_card?.holder) {
    return data.provider_response.transaction.credit_card.holder;
  }
  
  // CSV columns
  if (data['Владелец карты']) return data['Владелец карты'];
  if (data['Держатель карты']) return data['Держатель карты'];
  
  return null;
}

/**
 * Extracts card last 4 digits
 */
export function extractCardLast4(data: any): string | null {
  if (!data) return null;
  
  if (data.card_last4) return data.card_last4;
  if (data.credit_card?.last_4) return data.credit_card.last_4;
  if (data.transaction?.credit_card?.last_4) return data.transaction.credit_card.last_4;
  
  // provider_response
  if (data.provider_response?.transaction?.credit_card?.last_4) {
    return data.provider_response.transaction.credit_card.last_4;
  }
  
  // From masked PAN
  const pan = data['Маскированный PAN'] || data['Номер карты'] || data.masked_pan;
  if (pan) {
    const last4 = pan.replace(/\D/g, '').slice(-4);
    if (last4.length === 4) return last4;
  }
  
  return null;
}

/**
 * Normalizes email address
 */
function normalizeEmail(email: string): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  // Basic email validation
  if (normalized.includes('@') && normalized.length > 5) {
    return normalized;
  }
  return null;
}

/**
 * Normalizes phone number (removes non-digits, adds +)
 */
function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  
  // Add + prefix if not present and starts with country code
  if (digits.startsWith('375') || digits.startsWith('7') || digits.startsWith('380')) {
    return '+' + digits;
  }
  if (digits.length >= 10) {
    return '+' + digits;
  }
  return phone.trim();
}

/**
 * Find profile by email in database
 */
export async function findProfileByEmail(
  supabase: any,
  email: string | null
): Promise<string | null> {
  if (!email) return null;
  
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .limit(1)
    .single();
  
  if (error || !data) return null;
  return data.id;
}

/**
 * Find profile by phone in database
 */
export async function findProfileByPhone(
  supabase: any,
  phone: string | null
): Promise<string | null> {
  if (!phone) return null;
  
  // Try exact match first
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .single();
  
  if (!error && data) return data.id;
  
  // Try with normalized phone (just digits)
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 9) {
    const { data: data2 } = await supabase
      .from('profiles')
      .select('id')
      .ilike('phone', `%${digits.slice(-9)}`)
      .limit(1)
      .single();
    
    if (data2) return data2.id;
  }
  
  return null;
}

/**
 * Auto-link payment to profile by email or phone
 * Returns profile_id if found, null otherwise
 */
export async function autoLinkPaymentToProfile(
  supabase: any,
  data: any
): Promise<string | null> {
  // Extract contact info
  const email = extractCustomerEmail(data);
  const phone = extractCustomerPhone(data);
  
  // Try email first (more reliable)
  let profileId = await findProfileByEmail(supabase, email);
  
  // Fallback to phone
  if (!profileId && phone) {
    profileId = await findProfileByPhone(supabase, phone);
  }
  
  return profileId;
}
