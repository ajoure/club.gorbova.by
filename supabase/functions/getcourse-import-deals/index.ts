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

// Маппинг статусов
const STATUS_MAP: Record<string, string> = {
  'payed': 'paid',
  'finished': 'paid', // завершён
  'completed': 'paid',
  'new': 'pending',
  'cancelled': 'canceled',
  'in_work': 'pending',
  'payment_waiting': 'pending',
  'part_payed': 'pending',
};

// GetCourse API helper - использует формат запроса GetCourse
async function gcRequest(
  config: GetCourseConfig,
  endpoint: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<any> {
  const url = `https://${config.account_name}.getcourse.ru/pl/api/${endpoint}`;
  
  const formData = new FormData();
  formData.append('key', config.secret_key);
  formData.append('action', action);
  
  // GetCourse требует params как JSON объект
  if (Object.keys(params).length > 0) {
    formData.append('params', JSON.stringify(params));
  }

  console.log(`GC Request: ${endpoint} action=${action} params=${JSON.stringify(params)}`);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const text = await response.text();
  console.log(`GC Response (${endpoint}): ${text.slice(0, 500)}`);
  
  try {
    return JSON.parse(text);
  } catch {
    console.error('GetCourse response not JSON:', text.slice(0, 500));
    throw new Error('Invalid response from GetCourse');
  }
}

// Получить все сделки из GetCourse с пагинацией
async function fetchAllDeals(
  config: GetCourseConfig,
  offerIds: string[],
  dateFrom?: string,
  dateTo?: string
): Promise<GCDeal[]> {
  const allDeals: GCDeal[] = [];
  
  for (const offerId of offerIds) {
    let page = 1;
    let hasMore = true;
    
    console.log(`Fetching deals for offer ${offerId}...`);
    
    while (hasMore) {
      const requestParams: Record<string, unknown> = {
        offer_id: parseInt(offerId),
        page,
        per_page: 100,
      };
      
      if (dateFrom) requestParams.created_at_from = dateFrom;
      if (dateTo) requestParams.created_at_to = dateTo;
      
      const response = await gcRequest(config, 'deals', 'getList', requestParams);
      
      if (!response.success) {
        console.error(`Error fetching deals for offer ${offerId}:`, response.error_message);
        break;
      }
      
      const deals = response.result?.items || [];
      console.log(`Page ${page}: fetched ${deals.length} deals`);
      
      for (const deal of deals) {
        allDeals.push({
          id: deal.id,
          deal_number: deal.deal_number || String(deal.id),
          deal_created_at: deal.created_at,
          deal_payed_at: deal.payed_at,
          deal_finished_at: deal.finished_at,
          deal_cost: parseFloat(deal.cost) || 0,
          deal_status: deal.status,
          offer_id: parseInt(offerId),
          offer_code: deal.offer_code,
          user_email: deal.user_email?.toLowerCase(),
          user_id: deal.user_id,
          user_first_name: deal.user?.first_name,
          user_last_name: deal.user?.last_name,
          user_phone: deal.user?.phone,
        });
      }
      
      // Проверяем есть ли еще страницы
      if (deals.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Rate limiting
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }
  
  console.log(`Total deals fetched: ${allDeals.length}`);
  return allDeals;
}

// Найти или создать профиль
async function findOrCreateProfile(
  supabase: any,
  deal: GCDeal
): Promise<{ id: string; user_id: string | null; isNew: boolean }> {
  // Ищем существующий профиль по email
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, user_id')
    .eq('email', deal.user_email)
    .maybeSingle();
  
  if (existing) {
    return { id: existing.id, user_id: existing.user_id, isNew: false };
  }
  
  // Ищем существующий профиль по gc_user_id в meta
  const { data: byGcId } = await supabase
    .from('profiles')
    .select('id, user_id')
    .contains('meta', { gc_user_id: deal.user_id })
    .maybeSingle();
  
  if (byGcId) {
    return { id: byGcId.id, user_id: byGcId.user_id, isNew: false };
  }
  
  // Создаем ghost профиль
  const fullName = [deal.user_first_name, deal.user_last_name].filter(Boolean).join(' ') || null;
  
  // Генерируем временный UUID для user_id (ghost профиль)
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
  if (deal.deal_status !== 'payed') {
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
  endDate.setDate(endDate.getDate() + 30); // 30 дней доступа
  
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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      action = 'import',
      offer_ids = Object.keys(OFFER_TARIFF_MAP), // По умолчанию все офферы клуба
      date_from,
      date_to,
      dry_run = false, // Если true - только подсчет без создания записей
      instance_id,
    } = body;

    console.log(`GetCourse Import Deals: action=${action}, offers=${offer_ids.join(',')}, dry_run=${dry_run}`);

    // Получаем конфиг GetCourse
    let instanceQuery = supabase
      .from('integration_instances')
      .select('*')
      .eq('provider', 'getcourse')
      .in('status', ['active', 'connected']);
    
    if (instance_id) {
      instanceQuery = instanceQuery.eq('id', instance_id);
    } else {
      instanceQuery = instanceQuery.eq('is_default', true);
    }

    const { data: instance } = await instanceQuery.maybeSingle();
    
    const finalInstance = instance || (await supabase
      .from('integration_instances')
      .select('*')
      .eq('provider', 'getcourse')
      .in('status', ['active', 'connected'])
      .limit(1)
      .maybeSingle()).data;

    if (!finalInstance) {
      return new Response(JSON.stringify({ error: 'GetCourse not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config: GetCourseConfig = {
      account_name: (finalInstance.config as any)?.account_name || '',
      secret_key: (finalInstance.config as any)?.secret_key || '',
    };

    if (!config.account_name || !config.secret_key) {
      return new Response(JSON.stringify({ error: 'GetCourse credentials not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Если action = preview - только получаем данные без импорта
    if (action === 'preview') {
      const deals = await fetchAllDeals(config, offer_ids, date_from, date_to);
      
      // Группируем по офферам и статусам
      const summary: Record<string, Record<string, number>> = {};
      for (const deal of deals) {
        const offerId = String(deal.offer_id);
        if (!summary[offerId]) summary[offerId] = {};
        if (!summary[offerId][deal.deal_status]) summary[offerId][deal.deal_status] = 0;
        summary[offerId][deal.deal_status]++;
      }
      
      return new Response(JSON.stringify({
        success: true,
        total: deals.length,
        summary,
        sample: deals.slice(0, 10), // Первые 10 для предпросмотра
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Полный импорт
    const result: ImportResult = {
      total_fetched: 0,
      profiles_created: 0,
      profiles_updated: 0,
      orders_created: 0,
      orders_skipped: 0,
      subscriptions_created: 0,
      errors: 0,
      details: [],
    };

    // Получаем все сделки
    const deals = await fetchAllDeals(config, offer_ids, date_from, date_to);
    result.total_fetched = deals.length;
    result.details.push(`Fetched ${deals.length} deals from GetCourse`);

    if (dry_run) {
      result.details.push('DRY RUN - no changes made');
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Обрабатываем каждую сделку
    for (const deal of deals) {
      try {
        // Проверяем что есть email
        if (!deal.user_email) {
          result.errors++;
          continue;
        }

        // Получаем tariff_id
        const tariffId = OFFER_TARIFF_MAP[String(deal.offer_id)];
        if (!tariffId) {
          result.details.push(`Unknown offer_id: ${deal.offer_id}`);
          result.errors++;
          continue;
        }

        // Получаем product_id
        const productId = await getProductIdByTariff(supabase, tariffId);
        if (!productId) {
          result.details.push(`No product for tariff: ${tariffId}`);
          result.errors++;
          continue;
        }

        // Создаем/находим профиль
        const profile = await findOrCreateProfile(supabase, deal);
        if (profile.isNew) {
          result.profiles_created++;
        } else {
          result.profiles_updated++;
        }

        // Создаем заказ
        const order = await createOrder(
          supabase, 
          deal, 
          profile.user_id!, 
          tariffId, 
          productId
        );
        
        if (order.isNew) {
          result.orders_created++;
        } else {
          result.orders_skipped++;
        }

        // Создаем подписку (только для оплаченных)
        const subscription = await createSubscription(
          supabase,
          deal,
          profile.user_id!,
          order.id,
          tariffId,
          productId
        );
        
        if (subscription?.isNew) {
          result.subscriptions_created++;
        }

      } catch (err) {
        result.errors++;
        console.error('Error processing deal:', deal.id, err);
      }
    }

    // Логируем результат
    await supabase.from('integration_logs').insert({
      instance_id: finalInstance.id,
      event_type: 'deals_import',
      result: result.errors > 0 ? 'partial' : 'success',
      error_message: result.errors > 0 ? `${result.errors} errors` : null,
      payload_meta: result,
    });

    result.details.push(`Import completed: ${result.orders_created} orders, ${result.subscriptions_created} subscriptions`);

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('GetCourse import error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
