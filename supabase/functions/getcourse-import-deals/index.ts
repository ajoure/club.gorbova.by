import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPurchaseSnapshot } from '../_shared/build-purchase-snapshot.ts';
import { isCalendarMonthProduct, calcCalendarMonthEnd } from '../_shared/resolve-access-window.ts';
import { writeLedgerEntry } from '../_shared/fulfillment-executor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GetCourseConfig {
  account_name: string;
  secret_key: string;
}

interface GCDeal {
  id: number;
  deal_number: string;
  deal_created_at: string;
  deal_payed_at?: string;
  deal_finished_at?: string;
  deal_cost: number;
  deal_status: string;
  offer_code?: string;
  offer_id?: number;
  user_email: string;
  user_id: number;
  user_first_name?: string;
  user_last_name?: string;
  user_phone?: string;
}

interface ImportResult {
  total_fetched: number;
  profiles_created: number;
  profiles_updated: number;
  orders_created: number;
  orders_skipped: number;
  subscriptions_created: number;
  errors: number;
  details: string[];
}

// DB SoT: tariff lookup uses tariffs.getcourse_offer_id (no hardcoded mapping)
// API import fetches tariff by getcourse_offer_id from DB at runtime.

// Маппинг статусов GetCourse -> наши статусы
const STATUS_MAP: Record<string, string> = {
  // Оплаченные (русские)
  'Оплачено': 'paid',
  'оплачено': 'paid',
  'Завершён': 'paid',
  'завершён': 'paid',
  'Завершен': 'paid',
  'завершен': 'paid',
  // Оплаченные (английские)
  'payed': 'paid',
  'paid': 'paid',
  'Paid': 'paid',
  'finished': 'paid',
  'completed': 'paid',
  'Completed': 'paid',
  // Pending
  'new': 'pending',
  'Новый': 'pending',
  'новый': 'pending',
  'in_work': 'pending',
  'В работе': 'pending',
  'в работе': 'pending',
  'payment_waiting': 'pending',
  'Ожидает оплаты': 'pending',
  'ожидает оплаты': 'pending',
  'part_payed': 'pending',
  // Отменённые
  'cancelled': 'canceled',
  'Отменён': 'canceled',
  'отменён': 'canceled',
  'Отменен': 'canceled',
  'отменен': 'canceled',
  'Ложный': 'canceled',
  'ложный': 'canceled',
};

// Умный маппинг статуса с fallback
function mapStatus(rawStatus: string): string {
  if (!rawStatus) return 'pending';
  const normalized = rawStatus.trim();
  
  // Прямой маппинг
  if (STATUS_MAP[normalized]) return STATUS_MAP[normalized];
  
  // Case-insensitive поиск
  const lower = normalized.toLowerCase();
  for (const [key, value] of Object.entries(STATUS_MAP)) {
    if (key.toLowerCase() === lower) return value;
  }
  
  // Fallback по ключевым словам
  if (lower.includes('оплач') || lower.includes('paid') || lower.includes('заверш') || lower.includes('finish')) return 'paid';
  if (lower.includes('отмен') || lower.includes('cancel') || lower.includes('ложн')) return 'canceled';
  
  return 'pending';
}

// Парсинг даты из разных форматов
function parseDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  
  const str = dateStr.trim();
  
  // ISO format: 2024-01-15 or 2024-01-15T10:30:00
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
  }
  
  // DD.MM.YYYY or DD.MM.YYYY HH:MM
  const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d;
  }
  
  // DD/MM/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Fallback: try native Date parsing
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return fallback;
  
  return null;
}

// Задержка для rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Преобразование табличного формата GetCourse (fields + items) в массив объектов
 */
function parseExportData(info: any, defaultOfferId?: string): any[] {
  const fields = info.fields || [];
  const items = info.items || [];
  
  if (!Array.isArray(fields) || !Array.isArray(items)) {
    console.log('[parseExportData] Invalid format - fields or items not arrays');
    return [];
  }
  
  console.log(`[parseExportData] Fields: ${JSON.stringify(fields)}`);
  console.log(`[parseExportData] First item: ${JSON.stringify(items[0])}`);
  
  // Создаём маппинг индексов колонок (поддержка разных названий)
  const fieldMap: Record<string, number> = {};
  fields.forEach((field: string, index: number) => {
    fieldMap[field] = index;
  });
  
  console.log(`[parseExportData] Field map: ${JSON.stringify(fieldMap)}`);
  
  // Преобразуем каждую строку в объект
  return items.map((row: any[]) => {
    // Получаем значения по известным названиям колонок
    const id = row[fieldMap['ID заказа']] || row[fieldMap['id']] || row[fieldMap['ID']];
    const number = row[fieldMap['Номер']] || row[fieldMap['number']];
    const email = row[fieldMap['Email']] || row[fieldMap['email']] || row[fieldMap['E-mail']];
    const phone = row[fieldMap['Телефон']] || row[fieldMap['phone']];
    const userName = row[fieldMap['Пользователь']] || row[fieldMap['user']] || '';
    const userId = row[fieldMap['ID пользователя']] || row[fieldMap['user_id']];
    const createdAt = row[fieldMap['Дата создания']] || row[fieldMap['created_at']];
    const payedAt = row[fieldMap['Дата оплаты']] || row[fieldMap['payed_at']];
    const status = row[fieldMap['Статус']] || row[fieldMap['status']];
    const offerName = row[fieldMap['Состав заказа']] || row[fieldMap['Предложение']] || row[fieldMap['offer']];
    
    // Стоимость может быть в разных форматах
    const costRaw = row[fieldMap['Стоимость, BYN']] 
      || row[fieldMap['Стоимость']] 
      || row[fieldMap['cost']] 
      || row[fieldMap['Сумма']]
      || '0';
    const cost = parseFloat(String(costRaw).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    
    // Разделяем имя пользователя
    const nameParts = String(userName).trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    return {
      id,
      deal_number: number || String(id),
      user_id: userId,
      user_email: String(email || '').toLowerCase().trim(),
      user_phone: phone,
      user_first_name: firstName,
      user_last_name: lastName,
      deal_created_at: createdAt,
      deal_payed_at: payedAt,
      deal_status: status,
      deal_cost: cost,
      offer_name: offerName,
      offer_id: defaultOfferId ? parseInt(defaultOfferId) : null,
    };
  });
}

/**
 * GetCourse Export API - двухэтапный процесс
 * Шаг 1: Инициировать экспорт через /pl/api/account/deals
 * Шаг 2: Получить результаты через /pl/api/account/exports/{export_id}
 */
async function exportDeals(
  config: GetCourseConfig,
  filters: Record<string, string>
): Promise<GCDeal[]> {
  // Шаг 1: Инициировать экспорт
  const params = new URLSearchParams({
    key: config.secret_key,
    ...filters
  });
  
  const initUrl = `https://${config.account_name}.getcourse.ru/pl/api/account/deals?${params}`;
  console.log(`[Export Step 1] Initiating export: ${initUrl.replace(config.secret_key, '***')}`);
  
  const initResponse = await fetch(initUrl);
  const initText = await initResponse.text();
  console.log(`[Export Step 1] Response: ${initText.slice(0, 500)}`);
  
  let initData;
  try {
    initData = JSON.parse(initText);
  } catch {
    console.error('[Export Step 1] Invalid JSON response');
    throw new Error('Не удалось распарсить ответ GetCourse');
  }
  
  if (!initData.success) {
    console.error('[Export Step 1] Error:', initData.error_message || initData.error);
    throw new Error(initData.error_message || 'Не удалось запустить экспорт');
  }
  
  const exportId = initData.info?.export_id;
  if (!exportId) {
    console.error('[Export Step 1] No export_id in response:', JSON.stringify(initData));
    throw new Error('Не получен export_id от GetCourse');
  }
  
  console.log(`[Export Step 1] Export started, export_id: ${exportId}`);
  
  // Шаг 2: Ожидание и получение результатов (polling)
  let attempts = 0;
  const maxAttempts = 60; // 2 минуты максимум
  const offerId = filters.offer_id; // Запоминаем для привязки к сделкам
  
  while (attempts < maxAttempts) {
    await delay(2000); // Ждём 2 секунды между запросами
    
    const resultUrl = `https://${config.account_name}.getcourse.ru/pl/api/account/exports/${exportId}?key=${config.secret_key}`;
    console.log(`[Export Step 2] Polling attempt ${attempts + 1}: ${resultUrl.replace(config.secret_key, '***')}`);
    
    const resultResponse = await fetch(resultUrl);
    const resultText = await resultResponse.text();
    console.log(`[Export Step 2] Response length: ${resultText.length}, preview: ${resultText.slice(0, 1500)}`);
    
    let resultData;
    try {
      resultData = JSON.parse(resultText);
    } catch {
      console.error('[Export Step 2] Invalid JSON response');
      attempts++;
      continue;
    }
    
    // Проверяем успешность
    if (!resultData.success) {
      console.log(`[Export Step 2] Not ready yet, status: ${resultData.error_message || 'processing'}`);
      attempts++;
      continue;
    }
    
    // Данные готовы - парсим табличный формат
    const info = resultData.info;
    
    // Проверяем формат: табличный (fields + items) или объектный
    if (info && Array.isArray(info.fields) && Array.isArray(info.items)) {
      console.log(`[Export Step 2] Tabular format detected, parsing...`);
      const parsed = parseExportData(info, offerId);
      console.log(`[Export Step 2] Parsed ${parsed.length} deals`);
      
      if (parsed.length > 0) {
        console.log(`[Export Step 2] Sample parsed deal: ${JSON.stringify(parsed[0])}`);
      }
      
      return parsed.map(normalizeDeal);
    }
    
    // Fallback: старый формат (массив объектов)
    const items = info?.items || info || [];
    console.log(`[Export Step 2] Export complete, items: ${Array.isArray(items) ? items.length : 'not array'}`);
    
    if (Array.isArray(items)) {
      return items.map(normalizeDeal);
    }
    
    // Если items не массив, проверяем другие форматы
    if (typeof items === 'object') {
      const values = Object.values(items);
      if (values.length > 0) {
        return values.map(normalizeDeal);
      }
    }
    
    console.log('[Export Step 2] No items found in response');
    return [];
  }
  
  throw new Error('Таймаут ожидания экспорта (2 минуты)');
}

/**
 * Нормализация сделки из разных форматов GetCourse
 */
function normalizeDeal(deal: any): GCDeal {
  return {
    id: deal.id || deal.deal_id,
    deal_number: deal.deal_number || deal.number || String(deal.id || deal.deal_id),
    deal_created_at: deal.deal_created_at || deal.created_at || new Date().toISOString(),
    deal_payed_at: deal.deal_payed_at || deal.payed_at || deal.finished_at || deal.deal_finished_at,
    deal_finished_at: deal.deal_finished_at || deal.finished_at,
    deal_cost: typeof deal.deal_cost === 'number' ? deal.deal_cost : (parseFloat(deal.cost || deal.deal_cost || '0') || 0),
    deal_status: deal.deal_status || deal.status || deal.status_name || 'payed',
    offer_id: deal.offer_id || parseInt(deal.position_id || '0') || 0,
    offer_code: deal.offer_code || deal.position_code,
    user_email: (deal.user_email || deal.email || '')?.toLowerCase()?.trim(),
    user_id: deal.user_id || 0,
    user_first_name: deal.user_first_name || deal.first_name,
    user_last_name: deal.user_last_name || deal.last_name,
    user_phone: deal.user_phone || deal.phone,
  };
}

/**
 * Получить все сделки из GetCourse через Export API
 */
async function fetchAllDeals(
  config: GetCourseConfig,
  offerIds: string[],
  dateFrom?: string,
  dateTo?: string
): Promise<GCDeal[]> {
  const allDeals: GCDeal[] = [];
  
  for (const offerId of offerIds) {
    console.log(`\n=== Fetching deals for offer ${offerId} ===`);
    
    try {
      // Формируем фильтры согласно документации
      const filters: Record<string, string> = {
        status: 'payed', // Только оплаченные
        offer_id: offerId,
      };
      
      // Добавляем даты если указаны
      if (dateFrom) filters['created_at[from]'] = dateFrom;
      if (dateTo) filters['created_at[to]'] = dateTo;
      
      console.log(`Filters: ${JSON.stringify(filters)}`);
      
      const deals = await exportDeals(config, filters);
      console.log(`Fetched ${deals.length} deals for offer ${offerId}`);
      
      // Добавляем offer_id к каждой сделке (на случай если его нет в данных)
      for (const deal of deals) {
        if (!deal.offer_id) {
          deal.offer_id = parseInt(offerId);
        }
        allDeals.push(deal);
      }
      
      // Rate limiting - не более 100 запросов в 2 часа
      await delay(500);
      
    } catch (error) {
      console.error(`Error fetching deals for offer ${offerId}:`, error);
      // Продолжаем с другими офферами
    }
  }
  
  console.log(`\n=== Total deals fetched: ${allDeals.length} ===`);
  return allDeals;
}

/**
 * Нормализация имени - убирает дубли и умно разделяет на имя/фамилию
 * Примеры:
 * - "Иван Иванов Иван Иванов" -> "Иван Иванов"
 * - "Самохвалова Самохвалова" -> "Самохвалова" (одно слово)
 * - "Writerbroskov Writerbroskov" -> "Writerbroskov"
 * - "Иванько Юлия" -> firstName="Юлия", lastName="Иванько" (если похоже на фамилия+имя)
 */
function normalizeName(name: string): { firstName: string; lastName: string; fullName: string } {
  if (!name) return { firstName: "", lastName: "", fullName: "" };
  
  // Split and clean
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "", fullName: "" };
  
  // Capitalize each part
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const capitalizedParts = parts.map(capitalize);
  
  // Case 1: Two identical words (e.g., "Самохвалова Самохвалова" -> "Самохвалова")
  if (capitalizedParts.length === 2 && capitalizedParts[0] === capitalizedParts[1]) {
    return {
      firstName: capitalizedParts[0],
      lastName: "",
      fullName: capitalizedParts[0],
    };
  }
  
  // Case 2: Four+ words with repeated halves (e.g., "Иван Иванов Иван Иванов" -> "Иван Иванов")
  const halfLen = Math.floor(capitalizedParts.length / 2);
  if (capitalizedParts.length >= 4 && capitalizedParts.length % 2 === 0) {
    const firstHalf = capitalizedParts.slice(0, halfLen).join(" ");
    const secondHalf = capitalizedParts.slice(halfLen).join(" ");
    if (firstHalf === secondHalf) {
      return {
        firstName: capitalizedParts[0],
        lastName: capitalizedParts.slice(1, halfLen).join(" "),
        fullName: firstHalf,
      };
    }
  }
  
  // Case 3: Smart detection of "Фамилия Имя" vs "Имя Фамилия" pattern
  // Russian surnames often end with: -ов, -ева, -ая, -ий, -ко, -ец, -ин, -ына
  // Russian first names are often simpler
  if (capitalizedParts.length === 2) {
    const surnamePatterns = /^.+(ов|ова|ев|ева|ин|ина|ский|ская|ий|ая|ко|ец|ец|ын|ына|их|ых|ук|юк|ич|вич|ович|евич)$/i;
    const firstPart = capitalizedParts[0];
    const secondPart = capitalizedParts[1];
    
    const firstIsSurname = surnamePatterns.test(firstPart);
    const secondIsSurname = surnamePatterns.test(secondPart);
    
    // If first looks like surname and second doesn't, swap them
    if (firstIsSurname && !secondIsSurname) {
      return {
        firstName: secondPart,
        lastName: firstPart,
        fullName: `${secondPart} ${firstPart}`, // Proper order: Имя Фамилия
      };
    }
  }
  
  // Standard case: first part is firstName, rest is lastName
  return {
    firstName: capitalizedParts[0],
    lastName: capitalizedParts.slice(1).join(" "),
    fullName: capitalizedParts.join(" "),
  };
}

// Найти или создать профиль (с поддержкой нормализации имён и слияния дублей)
async function findOrCreateProfile(
  supabase: any,
  deal: GCDeal,
  normalizeNames: boolean = true,
  mergeEmailDuplicates: boolean = true
): Promise<{ id: string; user_id: string | null; isNew: boolean }> {
  if (!deal.user_email) {
    throw new Error('Email обязателен для создания профиля');
  }
  
  const email = deal.user_email.toLowerCase().trim();
  
  // Ищем существующий профиль по email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, user_id, full_name, first_name, last_name')
    .eq('email', email)
    .maybeSingle();
  
  if (existing) {
    // Если нужно нормализовать имя и обновить профиль
    if (normalizeNames && deal.user_first_name) {
      const rawName = [deal.user_first_name, deal.user_last_name].filter(Boolean).join(' ');
      const normalized = normalizeName(rawName);
      
      // Обновляем если имя отличается
      if (normalized.fullName && normalized.fullName !== existing.full_name) {
        await supabase
          .from('profiles')
          .update({
            full_name: normalized.fullName,
            first_name: normalized.firstName,
            last_name: normalized.lastName,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
    }
    
    return { id: existing.id, user_id: existing.user_id, isNew: false };
  }
  
  // Создаем ghost профиль
  let fullName = [deal.user_first_name, deal.user_last_name].filter(Boolean).join(' ') || null;
  let firstName = deal.user_first_name || '';
  let lastName = deal.user_last_name || '';
  
  // Нормализуем имя если нужно
  if (normalizeNames && fullName) {
    const normalized = normalizeName(fullName);
    fullName = normalized.fullName || fullName;
    firstName = normalized.firstName || firstName;
    lastName = normalized.lastName || lastName;
  }
  
  // Ghost profiles don't have a real auth user, so user_id is null
  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert({
      user_id: null,  // No auth user for ghost profiles
      email: email,
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      phone: deal.user_phone,
      status: 'ghost',
    })
    .select('id, user_id')
    .single();
  
  if (error) {
    console.error('Error creating ghost profile:', error);
    throw error;
  }
  
  return { id: newProfile.id, user_id: newProfile.user_id, isNew: true };
}

// Получить product_id по tariff_id
async function getProductIdByTariff(supabase: any, tariffId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tariffs')
    .select('product_id')
    .eq('id', tariffId)
    .single();
  
  return data?.product_id || null;
}

// Создать заказ
async function createOrder(
  supabase: any,
  deal: GCDeal,
  profileUserId: string,
  tariffId: string | null,
  productId: string | null
): Promise<{ id: string; isNew: boolean }> {
  // Проверяем дубликат по gc_deal_id (skip if no stable external id)
  if (deal.id && deal.id !== 0) {
    const { data: existing } = await supabase
      .from('orders_v2')
      .select('id')
      .contains('meta', { gc_deal_id: deal.id })
      .maybeSingle();
    
    if (existing) {
      return { id: existing.id, isNew: false };
    }
  }
  
  // Также проверяем по order_number
  // Avoid double prefix: if deal_number already starts with GC- or HASH-, use as-is or add GC- once
  const dealNumStr = String(deal.deal_number);
  const gcOrderNumber = dealNumStr.startsWith('GC-') ? dealNumStr : `GC-${dealNumStr}`;
  const { data: byNumber } = await supabase
    .from('orders_v2')
    .select('id')
    .eq('order_number', gcOrderNumber)
    .maybeSingle();
  
  if (byNumber) {
    return { id: byNumber.id, isNew: false };
  }
  
  // Маппинг статуса с умным fallback
  const status = mapStatus(deal.deal_status);
  
  const orderData = {
    order_number: gcOrderNumber,
    user_id: profileUserId,
    product_id: productId,
    tariff_id: tariffId,
    base_price: deal.deal_cost,
    final_price: deal.deal_cost,
    paid_amount: status === 'paid' ? deal.deal_cost : 0,
    currency: 'BYN',
    status,
    customer_email: deal.user_email,
    customer_phone: deal.user_phone,
    is_trial: false,
    meta: {
      gc_deal_id: deal.id && deal.id !== 0 ? deal.id : null,
      gc_deal_number: deal.deal_number,
      gc_user_id: deal.user_id,
      gc_offer_id: deal.offer_id,
      imported_at: new Date().toISOString(),
    },
    purchase_snapshot: buildPurchaseSnapshot({
      product_id: productId,
      tariff_id: tariffId,
      price: deal.deal_cost,
      currency: 'BYN',
      reconcile_source: 'getcourse_historical',
      extra: {
        gc_deal_id: deal.id,
        gc_offer_id: deal.offer_id,
        import_source: 'getcourse_import_deals',
      },
    }),
    created_at: deal.deal_created_at,
    updated_at: deal.deal_payed_at || deal.deal_created_at,
  };
  
  const { data: newOrder, error } = await supabase
    .from('orders_v2')
    .insert(orderData)
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating order:', error);
    throw error;
  }
  
  return { id: newOrder.id, isNew: true };
}

// Создать подписку
interface DealWithAccessDates extends GCDeal {
  accessStartAt?: string;
  accessEndAt?: string;
}

async function createSubscription(
  supabase: any,
  deal: DealWithAccessDates,
  profileUserId: string,
  orderId: string,
  tariffId: string,
  productId: string
): Promise<{ id: string; isNew: boolean; isActive: boolean; accessEndAt: string } | null> {
  // Только для оплаченных сделок (используем умный маппинг)
  const mappedStatus = mapStatus(deal.deal_status);
  if (mappedStatus !== 'paid') {
    return null;
  }
  
  // Проверяем существующую подписку
  const { data: existing } = await supabase
    .from('subscriptions_v2')
    .select('id, status, access_end_at')
    .eq('order_id', orderId)
    .maybeSingle();
  
  if (existing) {
    const isActive = existing.status === 'active';
    return { id: existing.id, isNew: false, isActive, accessEndAt: existing.access_end_at };
  }
  
  // Даты доступа из импорта или fallback
  let accessStartAt: Date;
  let accessEndAt: Date;
  
  if (deal.accessEndAt) {
    // Используем реальную дату окончания из импорта
    const parsedEnd = parseDate(deal.accessEndAt);
    if (parsedEnd) {
      accessEndAt = parsedEnd;
      // Начало: из импорта или от даты оплаты
      const parsedStart = deal.accessStartAt ? parseDate(deal.accessStartAt) : null;
      accessStartAt = parsedStart || new Date(deal.deal_payed_at || deal.deal_created_at);
    } else {
      // Если не удалось распарсить - fallback
      accessStartAt = new Date(deal.deal_payed_at || deal.deal_created_at);
      accessEndAt = new Date(accessStartAt);
      accessEndAt.setDate(accessEndAt.getDate() + 30);
    }
  } else {
    // Fallback: use config rule for calendar month
    accessStartAt = new Date(deal.deal_payed_at || deal.deal_created_at);
    
    // Phase 1: Check calendar month from products_v2.meta instead of hardcoded UUID
    // Note: isCalendarMonth flag must be passed from caller since this is a sync function context
    // The productId-based check happens in the caller; here we use the flag
    const useCalendarMonth = productId ? await isCalendarMonthProduct(supabase, productId) : false;
    
    if (useCalendarMonth) {
      accessEndAt = calcCalendarMonthEnd(accessStartAt, 21); // 21:00 UTC = 00:00 Minsk
    } else {
      accessEndAt = new Date(accessStartAt);
      accessEndAt.setDate(accessEndAt.getDate() + 30);
    }
  }
  
  // Определяем статус: active если дата окончания >= сегодня
  const now = new Date();
  const status = accessEndAt >= now ? 'active' : 'expired';
  const isActive = status === 'active';
  
  const subscriptionData = {
    user_id: profileUserId,
    product_id: productId,
    tariff_id: tariffId,
    order_id: orderId,
    status,
    access_start_at: accessStartAt.toISOString(),
    access_end_at: accessEndAt.toISOString(),
    is_trial: false,
    meta: {
      gc_deal_id: deal.id,
      imported_at: new Date().toISOString(),
      access_dates_from_import: !!deal.accessEndAt,
    },
  };
  
  const { data: newSub, error } = await supabase
    .from('subscriptions_v2')
    .insert(subscriptionData)
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
  
  return { id: newSub.id, isNew: true, isActive, accessEndAt: accessEndAt.toISOString() };
}

// Найти тариф по коду
async function findTariffByCode(supabase: any, code: string): Promise<{ id: string; product_id: string } | null> {
  if (!code || code === 'UNKNOWN' || code === 'skip') {
    return null;
  }
  
  const { data } = await supabase
    .from('tariffs')
    .select('id, product_id')
    .eq('code', code.toLowerCase())
    .eq('is_active', true)
    .maybeSingle();
  
  return data;
}

// Deterministic hash for fallback row keys (no timestamp, no random)
// MUST be byte-identical to the implementation in bepaid-report-import/index.ts
async function stableRowHash(payload: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(
    Object.keys(payload).sort().reduce((acc, k) => { acc[k] = payload[k]; return acc; }, {} as Record<string, unknown>)
  );
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Обработка импорта из файла (режим file)
async function processFileDeals(
  supabase: any,
  deals: any[],
  settings: any,
  batchContext: {
    batchId: string;
    batchSourceEventKey: string;
    batchStartResult: { id: string | null; execution_key: string | null; error: any };
    sourceEventType: string;
  }
): Promise<ImportResult> {
  const result: ImportResult = {
    total_fetched: deals.length,
    profiles_created: 0,
    profiles_updated: 0,
    orders_created: 0,
    orders_skipped: 0,
    subscriptions_created: 0,
    errors: 0,
    details: [],
  };
  
  const normalizeNames = settings?.normalizeNames !== false;
  const mergeEmailDuplicates = settings?.mergeEmailDuplicates !== false;
  const { batchId, batchSourceEventKey, batchStartResult, sourceEventType } = batchContext;
  
  console.log(`[File Import] Processing ${deals.length} deals`);
  console.log(`[File Import] Settings: normalizeNames=${normalizeNames}, mergeEmailDuplicates=${mergeEmailDuplicates}`);
  
  for (let index = 0; index < deals.length; index++) {
    const deal = deals[index];

    // Rate limiting: pause every 200 rows
    if (index > 0 && index % 200 === 0) {
      await new Promise(r => setTimeout(r, 100));
    }

    // Compute canonical hash from raw business payload (no runtime entropy, no index, no operator settings)
    const canonicalHash = await stableRowHash({
      source: 'gc_file',
      email: (deal.user_email || '').toLowerCase().trim(),
      phone: (deal.user_phone || '').trim(),
      first_name: (deal.user_first_name || '').trim(),
      last_name: (deal.user_last_name || '').trim(),
      amount: String(deal.amount || 0),
      paid_at: deal.paidAt || deal.createdAt || '',
      tariff_code: deal.tariffCode || '',
      access_start: deal.accessStartAt || '',
      access_end: deal.accessEndAt || '',
    });

    // Deterministic row identity: externalId when available, otherwise canonical hash only
    const externalId = deal.externalId || deal.id;
    const rowSourceEventKey = externalId
      ? `gc-import:${batchId}:row:${externalId}`
      : `gc-import:${batchId}:row:hash:${canonicalHash}`;
    const rowSubjectRef = externalId ? String(externalId) : `hash:${canonicalHash}`;

    // Deterministic deal_number: externalId or HASH-based (no Date.now, no Math.random)
    // Two identical rows without externalId → same hash → conscious dedup (second is duplicate)
    const stableDealNumber = externalId ? String(externalId) : `HASH-${canonicalHash}`;

    let currentStep = 'row_parse';

    try {
      const tariffCode = deal.tariffCode;
      
      // Skip unknown or explicitly skipped
      if (tariffCode === 'UNKNOWN' || tariffCode === 'skip' || !tariffCode) {
        result.orders_skipped++;
        result.details.push(`Пропущено: ${deal.user_email} - тариф не определён`);
        // Ledger: skip row (no matching target)
        await writeLedgerEntry(supabase, {
          source_event_type: sourceEventType as any,
          source_event_key: rowSourceEventKey,
          source_subject_type: 'import_batch',
          source_subject_ref: rowSubjectRef,
          action_type: 'skip',
          status: 'skipped',
          reason_code: 'no_matching_target',
          target_type: 'product',
          target_key: `unknown:unknown`,
          parent_event_key: batchSourceEventKey,
          parent_execution_key: batchStartResult?.execution_key || null,
          result: { skip_reason: 'tariff_not_determined', tariff_code: tariffCode || null, row_index: index },
        });
        continue;
      }
      
      let tariffId: string | null = null;
      let productId: string | null = null;
      let isArchiveDeal = false;
      
      // ARCHIVE PSEUDO-TARGET CONTRACT (sanctioned temporary):
      // While no canonical archive product_id exists in products_v2:
      //   target_type = 'product', target_key = '{userId}:archive'
      //   result.is_archive_deal = true, result.archive_target_contract = 'pseudo_target_v1'
      // When canonical archive product_id is added to products_v2:
      //   switch to target_key = '{userId}:{archiveProductId}'
      //   document change as "archive_target_contract_v2" in proof
      if (tariffCode === 'ARCHIVE_UNKNOWN') {
        console.log(`[File Import] Archive deal (no tariff) for ${deal.user_email}`);
        isArchiveDeal = true;
      } else {
        // Find tariff by code (DB SoT via tariffs.getcourse_offer_id — no hardcoded map)
        currentStep = 'profile_resolve';
        const tariff = await findTariffByCode(supabase, tariffCode);
        if (!tariff) {
          console.log(`[File Import] Tariff not found: ${tariffCode}, creating order without tariff`);
          isArchiveDeal = true;
        } else {
          tariffId = tariff.id;
          productId = tariff.product_id;
        }
      }
      
      // Normalize the deal structure with access dates — deterministic identity only
      currentStep = 'profile_resolve';
      const normalizedDeal: DealWithAccessDates = {
        id: externalId || canonicalHash,
        deal_number: stableDealNumber,
        deal_created_at: deal.createdAt || new Date().toISOString(),
        deal_payed_at: deal.paidAt || deal.createdAt,
        deal_cost: parseFloat(deal.amount) || 0,
        deal_status: deal.status || 'payed',
        user_email: deal.user_email,
        user_id: 0,
        user_first_name: deal.user_first_name,
        user_last_name: deal.user_last_name,
        user_phone: deal.user_phone,
        // Даты доступа из импорта
        accessStartAt: deal.accessStartAt || '',
        accessEndAt: deal.accessEndAt || '',
      };
      
      // Create/find profile
      const profile = await findOrCreateProfile(supabase, normalizedDeal, normalizeNames, mergeEmailDuplicates);
      if (profile.isNew) {
        result.profiles_created++;
      } else {
        result.profiles_updated++;
      }
      
      // Create order - use profile.id for ghost profiles (user_id may be null)
      currentStep = 'order_create';
      const userIdForRecords = profile.user_id || profile.id;
      const order = await createOrder(supabase, normalizedDeal, userIdForRecords, tariffId, productId);
      if (order.isNew) {
        result.orders_created++;
        if (isArchiveDeal) {
          result.details.push(`Создан заказ (без тарифа): ${deal.user_email}`);
        }
      } else {
        result.orders_skipped++;
        // Ledger: skip row (duplicate order)
        await writeLedgerEntry(supabase, {
          source_event_type: sourceEventType as any,
          source_event_key: rowSourceEventKey,
          source_subject_type: 'import_batch',
          source_subject_ref: rowSubjectRef,
          action_type: 'skip',
          status: 'skipped',
          reason_code: 'duplicate_skip',
          target_type: tariffId ? 'subscription_tier' : 'product',
          target_key: tariffId ? `${userIdForRecords}:${tariffId}` : `${userIdForRecords}:${isArchiveDeal ? 'archive' : (productId || 'unknown')}`,
          user_id: userIdForRecords,
          profile_id: profile.id,
          order_id: order.id,
          source_order_id: order.id,
          parent_event_key: batchSourceEventKey,
          parent_execution_key: batchStartResult?.execution_key || null,
          result: { skip_reason: 'order_already_exists', existing_order_id: order.id, row_index: index, ...(isArchiveDeal ? { is_archive_deal: true, archive_target_contract: 'pseudo_target_v1' } : {}) },
        });
        continue; // Skip subscription creation for duplicate orders
      }
      
      // Create subscription for paid deals only if we have tariff/product
      currentStep = 'subscription_apply';
      let subscription = null;
      if (tariffId && productId) {
        subscription = await createSubscription(
          supabase, normalizedDeal, userIdForRecords, order.id, tariffId, productId
        );
      }

      // Ledger: grant row
      currentStep = 'ledger_write';
      const rowLedgerResult = await writeLedgerEntry(supabase, {
        source_event_type: sourceEventType as any,
        source_event_key: rowSourceEventKey,
        source_subject_type: 'import_batch',
        source_subject_ref: rowSubjectRef,
        action_type: 'grant',
        status: 'granted',
        reason_code: 'bulk_import',
        target_type: tariffId ? 'subscription_tier' : 'product',
        target_key: tariffId ? `${userIdForRecords}:${tariffId}` : `${userIdForRecords}:${isArchiveDeal ? 'archive' : (productId || 'unknown')}`,
        user_id: userIdForRecords,
        profile_id: profile.id,
        order_id: order.id,
        source_order_id: order.id,
        source_subscription_id: subscription?.id || null,
        parent_event_key: batchSourceEventKey,
        parent_execution_key: batchStartResult?.execution_key || null,
        result: {
          is_archive_deal: isArchiveDeal,
          ...(isArchiveDeal ? { archive_target_contract: 'pseudo_target_v1' } : {}),
          subscription_created: subscription?.isNew || false,
          subscription_active: subscription?.isActive || false,
          row_index: index,
        },
      });

      if (subscription?.isNew) {
        result.subscriptions_created++;
        
        // Автоматическая выдача доступа в Telegram для активных подписок
        // Downstream only for grant/granted rows (not skip/failed)
        currentStep = 'downstream_sync';
        if (subscription.isActive) {
          try {
            // Проверяем, есть ли у продукта telegram_club_id
            const { data: product } = await supabase
              .from('products_v2')
              .select('telegram_club_id')
              .eq('id', productId)
              .single();
            
            if (product?.telegram_club_id) {
              // Downstream telegram-grant-access with idempotent parent guard
              if (rowLedgerResult?.execution_key) {
                await supabase.functions.invoke('telegram-grant-access', {
                  body: {
                    user_id: userIdForRecords,
                    club_id: product.telegram_club_id,
                    valid_until: subscription.accessEndAt,
                    source: 'import',
                    parent_event_key: rowSourceEventKey,
                    parent_execution_key: rowLedgerResult.execution_key,
                    _from_primary_path: true,
                  },
                });
              } else {
                // Idempotent skip or null execution_key:
                // Try to recover existing execution_key from ledger
                const { data: existingRow } = await supabase
                  .from('access_grant_ledger')
                  .select('execution_key')
                  .eq('source_event_key', rowSourceEventKey)
                  .maybeSingle();

                if (existingRow?.execution_key) {
                  await supabase.functions.invoke('telegram-grant-access', {
                    body: {
                      user_id: userIdForRecords,
                      club_id: product.telegram_club_id,
                      valid_until: subscription.accessEndAt,
                      source: 'import',
                      parent_event_key: rowSourceEventKey,
                      parent_execution_key: existingRow.execution_key,
                      _from_primary_path: true,
                    },
                  });
                } else {
                  // No execution_key recoverable — call without _from_primary_path
                  await supabase.functions.invoke('telegram-grant-access', {
                    body: {
                      user_id: userIdForRecords,
                      club_id: product.telegram_club_id,
                      valid_until: subscription.accessEndAt,
                      source: 'import',
                    },
                  });
                }
              }
              result.details.push(`TG доступ: ${deal.user_email}`);
            }
          } catch (tgError) {
            console.error(`[File Import] Telegram grant failed for ${deal.user_email}:`, tgError);
            // Не прерываем импорт из-за ошибки Telegram
          }
        }
      }
      
    } catch (error) {
      console.error(`[File Import] Error processing deal:`, error);
      const errorMsg = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
      result.details.push(`Ошибка: ${deal.user_email} - ${errorMsg}`);
      result.errors++;

      // Ledger: failed row in per-row catch
      try {
        await writeLedgerEntry(supabase, {
          source_event_type: sourceEventType as any,
          source_event_key: rowSourceEventKey,
          source_subject_type: 'import_batch',
          source_subject_ref: rowSubjectRef,
          action_type: 'grant',
          status: 'failed',
          reason_code: 'bulk_import',
          target_type: 'product',
          target_key: `unknown:unknown`,
          parent_event_key: batchSourceEventKey,
          parent_execution_key: batchStartResult?.execution_key || null,
          result: { failed_at_step: currentStep, error_message: errorMsg, row_index: index },
        });
      } catch (ledgerErr) {
        console.error(`[File Import] Failed to write error ledger for row ${index}:`, ledgerErr);
      }
    }
  }
  
  console.log(`[File Import] Complete:`, result);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    
    // Поддерживаем оба формата именования параметров
    const action = body.action;
    const instanceId = body.instanceId || body.instance_id;
    const offerIds = body.offerIds || body.offer_ids;
    const dateFrom = body.dateFrom || body.date_from;
    const dateTo = body.dateTo || body.date_to;
    const fileDeals = body.fileDeals || body.deals;
    
    // Настройки нормализации (по умолчанию включены)
    const normalizeNames = body.settings?.normalizeNames !== false;
    const mergeEmailDuplicates = body.settings?.mergeEmailDuplicates !== false;
    
    console.log(`\n========== GetCourse Import ==========`);
    console.log(`Action: ${action}`);
    console.log(`Instance ID: ${instanceId}`);
    console.log(`File deals count: ${fileDeals?.length || 0}`);
    console.log(`Offer IDs: ${JSON.stringify(offerIds)}`);
    console.log(`Date range: ${dateFrom || 'not set'} - ${dateTo || 'not set'}`);
    console.log(`Normalize names: ${normalizeNames}, Merge email duplicates: ${mergeEmailDuplicates}`);

    // РЕЖИМ ФАЙЛА: если переданы deals из файла
    if (fileDeals && Array.isArray(fileDeals) && fileDeals.length > 0) {
      console.log(`[MODE] File import with ${fileDeals.length} deals`);

      // Volume guard: hard stop BEFORE any ledger write
      if (fileDeals.length > 1000 && !body.batch_mode) {
        return new Response(
          JSON.stringify({ error: 'batch_mode required for >1000 rows', count: fileDeals.length }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create batch_start ledger row
      const batchId = crypto.randomUUID();
      const batchSourceEventKey = `gc-import-batch:${batchId}`;
      const batchStartResult = await writeLedgerEntry(supabase, {
        source_event_type: 'admin', // file upload from admin UI
        source_event_key: batchSourceEventKey,
        source_subject_type: 'import_batch',
        source_subject_ref: batchId,
        action_type: 'batch_start',
        reason_code: 'batch_orchestration',
        target_type: 'batch',
        target_key: `gc-import:${batchId}`,
        status: 'completed',
        result: {
          batch_size: fileDeals.length,
          import_type: 'getcourse_file',
          mode: 'execute',
          started_at: new Date().toISOString(),
        },
      });

      const result = await processFileDeals(supabase, fileDeals, body.settings, {
        batchId,
        batchSourceEventKey,
        batchStartResult,
        sourceEventType: 'admin',
      });
      
      // Log the import
      if (instanceId) {
        await supabase.from('integration_logs').insert({
          instance_id: instanceId,
          event_type: 'file_import',
          result: result.errors > 0 ? 'partial' : 'success',
          payload_meta: {
            action: 'file_import',
            stats: {
              total: result.total_fetched,
              profiles_created: result.profiles_created,
              orders_created: result.orders_created,
              subscriptions_created: result.subscriptions_created,
              skipped: result.orders_skipped,
              errors: result.errors,
            },
          },
        });
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          result,
          orders_created: result.orders_created,
          profiles_created: result.profiles_created,
          subscriptions_created: result.subscriptions_created,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // РЕЖИМ API: требуется instance_id для GetCourse
    if (!instanceId) {
      throw new Error('Необходимо передать deals (файл) или instance_id (API GetCourse)');
    }

    // Получаем конфигурацию интеграции
    const { data: instance, error: instanceError } = await supabase
      .from('integration_instances')
      .select('config')
      .eq('id', instanceId)
      .single();

    if (instanceError || !instance) {
      throw new Error('Интеграция не найдена');
    }

    const config: GetCourseConfig = {
      account_name: (instance.config as any).account_name,
      secret_key: (instance.config as any).secret_key,
    };

    if (!config.account_name || !config.secret_key) {
      throw new Error('Не настроены параметры интеграции GetCourse');
    }

    console.log(`GetCourse account: ${config.account_name}`);

    // Получаем сделки
    const deals = await fetchAllDeals(config, offerIds, dateFrom, dateTo);

    if (action === 'preview') {
      // Группируем по offer_id и статусу
      const byOffer: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      
      for (const deal of deals) {
        const offerId = String(deal.offer_id);
        byOffer[offerId] = (byOffer[offerId] || 0) + 1;
        byStatus[deal.deal_status] = (byStatus[deal.deal_status] || 0) + 1;
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: deals.length,
            byOffer,
            byStatus,
            sample: deals.slice(0, 10).map(d => ({
              id: d.id,
              number: d.deal_number,
              email: d.user_email,
              phone: d.user_phone,
              firstName: d.user_first_name,
              lastName: d.user_last_name,
              cost: d.deal_cost,
              status: d.deal_status,
              offer_id: d.offer_id,
              created_at: d.deal_created_at,
            })),
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Volume guard: hard stop BEFORE any ledger write
    if (deals.length > 1000 && !body.batch_mode) {
      return new Response(
        JSON.stringify({ error: 'batch_mode required for >1000 rows', count: deals.length }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create batch_start ledger row for API import
    const apiBatchId = crypto.randomUUID();
    const apiBatchSourceEventKey = `gc-import-batch:${apiBatchId}`;
    const apiBatchStartResult = await writeLedgerEntry(supabase, {
      source_event_type: 'system', // API/scheduled origin
      source_event_key: apiBatchSourceEventKey,
      source_subject_type: 'import_batch',
      source_subject_ref: apiBatchId,
      action_type: 'batch_start',
      reason_code: 'batch_orchestration',
      target_type: 'batch',
      target_key: `gc-import:${apiBatchId}`,
      status: 'completed',
      result: {
        batch_size: deals.length,
        import_type: 'getcourse_api',
        mode: 'execute',
        started_at: new Date().toISOString(),
      },
    });

    // Импорт
    const result: ImportResult = {
      total_fetched: deals.length,
      profiles_created: 0,
      profiles_updated: 0,
      orders_created: 0,
      orders_skipped: 0,
      subscriptions_created: 0,
      errors: 0,
      details: [],
    };

    for (let index = 0; index < deals.length; index++) {
      const deal = deals[index];

      // Rate limiting: pause every 200 rows
      if (index > 0 && index % 200 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }

      // Compute deterministic canonical hash from raw business payload
      let apiCanonicalHash: string | null = null;
      if (!deal.id) {
        apiCanonicalHash = await stableRowHash({
          source: 'gc_api',
          email: (deal.user_email || '').toLowerCase().trim(),
          phone: (deal.user_phone || '').trim(),
          first_name: (deal.user_first_name || '').trim(),
          last_name: (deal.user_last_name || '').trim(),
          amount: String(deal.deal_cost || 0),
          paid_at: deal.deal_payed_at || deal.deal_created_at || '',
          offer_id: String(deal.offer_id || ''),
        });
      }
      // Identity without index — two identical rows = conscious dedup
      const rowSourceEventKey = deal.id
        ? `gc-import:${apiBatchId}:row:${deal.id}`
        : `gc-import:${apiBatchId}:row:hash:${apiCanonicalHash}`;
      const rowSubjectRef = deal.id ? String(deal.id) : `hash:${apiCanonicalHash}`;

      let currentStep = 'row_parse';
      try {
        // DB SoT: lookup tariff by getcourse_offer_id (no hardcoded mapping)
        currentStep = 'order_lookup';
        const { data: tariffMatch } = await supabase
          .from('tariffs')
          .select('id, product_id')
          .eq('getcourse_offer_id', deal.offer_id)
          .eq('is_active', true)
          .maybeSingle();
        const tariffId = tariffMatch?.id || null;
        if (!tariffId) {
          result.details.push(`Offer ${deal.offer_id} не найден в tariffs.getcourse_offer_id`);
          result.errors++;
          // Ledger: skip row (no matching target)
          await writeLedgerEntry(supabase, {
            source_event_type: 'system',
            source_event_key: rowSourceEventKey,
            source_subject_type: 'import_batch',
            source_subject_ref: rowSubjectRef,
            action_type: 'skip',
            status: 'skipped',
            reason_code: 'no_matching_target',
            target_type: 'product',
            target_key: `unknown:offer_${deal.offer_id}`,
            parent_event_key: apiBatchSourceEventKey,
            parent_execution_key: apiBatchStartResult?.execution_key || null,
            result: { skip_reason: 'offer_not_in_tariffs_db', offer_id: deal.offer_id },
          });
          continue;
        }

        // product_id already obtained from tariff lookup
        const productId = tariffMatch?.product_id || null;
        if (!productId) {
          result.details.push(`Product не найден для tariff ${tariffId}`);
          result.errors++;
          // Ledger: skip row (no matching target)
          await writeLedgerEntry(supabase, {
            source_event_type: 'system',
            source_event_key: rowSourceEventKey,
            source_subject_type: 'import_batch',
            source_subject_ref: rowSubjectRef,
            action_type: 'skip',
            status: 'skipped',
            reason_code: 'no_matching_target',
            target_type: 'product',
            target_key: `unknown:tariff_${tariffId}`,
            parent_event_key: apiBatchSourceEventKey,
            parent_execution_key: apiBatchStartResult?.execution_key || null,
            result: { skip_reason: 'product_not_found_for_tariff', tariff_id: tariffId },
          });
          continue;
        }

        // Создаём/находим профиль (с настройками нормализации)
        currentStep = 'profile_resolve';
        const profile = await findOrCreateProfile(supabase, deal, normalizeNames, mergeEmailDuplicates);
        if (profile.isNew) {
          result.profiles_created++;
        } else {
          result.profiles_updated++;
        }

        // Создаём заказ
        currentStep = 'order_create';
        const order = await createOrder(supabase, deal, profile.user_id!, tariffId, productId);
        if (order.isNew) {
          result.orders_created++;
        } else {
          result.orders_skipped++;
          // Ledger: skip row (duplicate order)
          await writeLedgerEntry(supabase, {
            source_event_type: 'system',
            source_event_key: rowSourceEventKey,
            source_subject_type: 'import_batch',
            source_subject_ref: rowSubjectRef,
            action_type: 'skip',
            status: 'skipped',
            reason_code: 'duplicate_skip',
            target_type: 'subscription_tier',
            target_key: `${profile.user_id}:${tariffId}`,
            user_id: profile.user_id,
            profile_id: profile.id,
            order_id: order.id,
            source_order_id: order.id,
            parent_event_key: apiBatchSourceEventKey,
            parent_execution_key: apiBatchStartResult?.execution_key || null,
            result: { skip_reason: 'order_already_exists', existing_order_id: order.id },
          });
          continue;
        }

        // Создаём подписку
        currentStep = 'subscription_apply';
        const subscription = await createSubscription(
          supabase, deal, profile.user_id!, order.id, tariffId, productId
        );

        // Ledger: grant row
        currentStep = 'ledger_write';
        await writeLedgerEntry(supabase, {
          source_event_type: 'system',
          source_event_key: rowSourceEventKey,
          source_subject_type: 'import_batch',
          source_subject_ref: rowSubjectRef,
          action_type: 'grant',
          status: 'granted',
          reason_code: 'bulk_import',
          target_type: 'subscription_tier',
          target_key: `${profile.user_id}:${tariffId}`,
          user_id: profile.user_id,
          profile_id: profile.id,
          order_id: order.id,
          source_order_id: order.id,
          source_subscription_id: subscription?.id || null,
          parent_event_key: apiBatchSourceEventKey,
          parent_execution_key: apiBatchStartResult?.execution_key || null,
          result: {
            subscription_created: subscription?.isNew || false,
            subscription_active: subscription?.isActive || false,
          },
        });

        if (subscription?.isNew) {
          result.subscriptions_created++;
        }

      } catch (error) {
        console.error(`Error processing deal ${deal.id}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.details.push(`Ошибка для сделки ${deal.deal_number}: ${errorMsg}`);
        result.errors++;

        // Ledger: failed row in per-row catch
        try {
          await writeLedgerEntry(supabase, {
            source_event_type: 'system',
            source_event_key: rowSourceEventKey,
            source_subject_type: 'import_batch',
            source_subject_ref: rowSubjectRef,
            action_type: 'grant',
            status: 'failed',
            reason_code: 'bulk_import',
            target_type: 'product',
            target_key: `unknown:unknown`,
            parent_event_key: apiBatchSourceEventKey,
            parent_execution_key: apiBatchStartResult?.execution_key || null,
            result: { failed_at_step: currentStep, error_message: errorMsg, row_index: index },
          });
        } catch (ledgerErr) {
          console.error(`[API Import] Failed to write error ledger for row ${index}:`, ledgerErr);
        }
      }
    }

    // Логируем результат
    await supabase.from('integration_logs').insert({
      instance_id: instanceId,
      event_type: 'import',
      result: result.errors > 0 ? 'partial' : 'success',
      payload_meta: {
        action: 'import_deals',
        offers: offerIds,
        dateFrom,
        dateTo,
        stats: {
          total_fetched: result.total_fetched,
          profiles_created: result.profiles_created,
          orders_created: result.orders_created,
          subscriptions_created: result.subscriptions_created,
          errors: result.errors,
        },
      },
    });

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Import error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
