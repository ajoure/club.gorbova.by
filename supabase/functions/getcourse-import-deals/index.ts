import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// Маппинг offer_id -> tariff_id
const OFFER_TARIFF_MAP: Record<string, string> = {
  '6744625': '31f75673-a7ae-420a-b5ab-5906e34cbf84', // CHAT
  '6744626': 'b276d8a5-8e5f-4876-9f99-36f818722d6c', // FULL
  '6744628': '7c748940-dcad-4c7c-a92e-76a2344622d3', // BUSINESS
};

// Маппинг статусов GetCourse -> наши статусы
const STATUS_MAP: Record<string, string> = {
  'payed': 'paid',
  'Завершён': 'paid',
  'finished': 'paid',
  'completed': 'paid',
  'new': 'pending',
  'cancelled': 'canceled',
  'in_work': 'pending',
  'payment_waiting': 'pending',
  'part_payed': 'pending',
  'Новый': 'pending',
  'В работе': 'pending',
  'Ожидает оплаты': 'pending',
  'Отменён': 'canceled',
  'Ложный': 'canceled',
};

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

// Найти или создать профиль
async function findOrCreateProfile(
  supabase: any,
  deal: GCDeal
): Promise<{ id: string; user_id: string | null; isNew: boolean }> {
  if (!deal.user_email) {
    throw new Error('Email обязателен для создания профиля');
  }
  
  // Ищем существующий профиль по email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, user_id')
    .eq('email', deal.user_email)
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, user_id: existing.user_id, isNew: false };
  }
  
  // Создаем ghost профиль
  const fullName = [deal.user_first_name, deal.user_last_name].filter(Boolean).join(' ') || null;
  const ghostUserId = crypto.randomUUID();
  
  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert({
      user_id: ghostUserId,
      email: deal.user_email,
      full_name: fullName,
      phone: deal.user_phone,
      status: 'ghost',
      meta: {
        source: 'getcourse_import',
        gc_user_id: deal.user_id,
        needs_migration: true,
        imported_at: new Date().toISOString(),
      },
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
  tariffId: string,
  productId: string
): Promise<{ id: string; isNew: boolean }> {
  // Проверяем дубликат по gc_deal_id
  const { data: existing } = await supabase
    .from('orders_v2')
    .select('id')
    .contains('meta', { gc_deal_id: deal.id })
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, isNew: false };
  }
  
  // Также проверяем по order_number
  const gcOrderNumber = `GC-${deal.deal_number}`;
  const { data: byNumber } = await supabase
    .from('orders_v2')
    .select('id')
    .eq('order_number', gcOrderNumber)
    .maybeSingle();
  
  if (byNumber) {
    return { id: byNumber.id, isNew: false };
  }
  
  // Маппинг статуса
  const status = STATUS_MAP[deal.deal_status] || 'pending';
  
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
      gc_deal_id: deal.id,
      gc_deal_number: deal.deal_number,
      gc_user_id: deal.user_id,
      gc_offer_id: deal.offer_id,
      imported_at: new Date().toISOString(),
    },
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
async function createSubscription(
  supabase: any,
  deal: GCDeal,
  profileUserId: string,
  orderId: string,
  tariffId: string,
  productId: string
): Promise<{ id: string; isNew: boolean } | null> {
  // Только для оплаченных сделок
  const isPaid = deal.deal_status === 'payed' || deal.deal_status === 'Завершён' || deal.deal_status === 'finished';
  if (!isPaid) {
    return null;
  }
  
  // Проверяем существующую подписку
  const { data: existing } = await supabase
    .from('subscriptions_v2')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, isNew: false };
  }
  
  // Рассчитываем период доступа
  const accessStartAt = deal.deal_payed_at || deal.deal_created_at;
  const startDate = new Date(accessStartAt);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30);
  
  // Определяем статус
  const now = new Date();
  const status = endDate > now ? 'active' : 'expired';
  
  const subscriptionData = {
    user_id: profileUserId,
    product_id: productId,
    tariff_id: tariffId,
    order_id: orderId,
    status,
    access_start_at: accessStartAt,
    access_end_at: endDate.toISOString(),
    is_trial: false,
    meta: {
      gc_deal_id: deal.id,
      imported_at: new Date().toISOString(),
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
  
  return { id: newSub.id, isNew: true };
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
    
    console.log(`\n========== GetCourse Import ==========`);
    console.log(`Action: ${action}`);
    console.log(`Instance ID: ${instanceId}`);
    console.log(`Offer IDs: ${JSON.stringify(offerIds)}`);
    console.log(`Date range: ${dateFrom || 'not set'} - ${dateTo || 'not set'}`);

    if (!instanceId) {
      throw new Error('instance_id обязателен');
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
            sample: deals.slice(0, 5).map(d => ({
              id: d.id,
              number: d.deal_number,
              email: d.user_email,
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

    for (const deal of deals) {
      try {
        // Проверяем маппинг тарифа
        const tariffId = OFFER_TARIFF_MAP[String(deal.offer_id)];
        if (!tariffId) {
          result.details.push(`Offer ${deal.offer_id} не найден в маппинге`);
          result.errors++;
          continue;
        }

        // Получаем product_id
        const productId = await getProductIdByTariff(supabase, tariffId);
        if (!productId) {
          result.details.push(`Product не найден для tariff ${tariffId}`);
          result.errors++;
          continue;
        }

        // Создаём/находим профиль
        const profile = await findOrCreateProfile(supabase, deal);
        if (profile.isNew) {
          result.profiles_created++;
        } else {
          result.profiles_updated++;
        }

        // Создаём заказ
        const order = await createOrder(supabase, deal, profile.user_id!, tariffId, productId);
        if (order.isNew) {
          result.orders_created++;
        } else {
          result.orders_skipped++;
        }

        // Создаём подписку
        const subscription = await createSubscription(
          supabase, deal, profile.user_id!, order.id, tariffId, productId
        );
        if (subscription?.isNew) {
          result.subscriptions_created++;
        }

      } catch (error) {
        console.error(`Error processing deal ${deal.id}:`, error);
        result.details.push(`Ошибка для сделки ${deal.deal_number}: ${error instanceof Error ? error.message : String(error)}`);
        result.errors++;
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
