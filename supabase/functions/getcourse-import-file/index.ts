import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DealFromFile {
  id: string | number;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  cost: number;
  status: string;
  offerName?: string;
  tariffId?: string;
  createdAt?: string;
  paidAt?: string;
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

// Маппинг статусов из Excel
const STATUS_MAP: Record<string, string> = {
  'Завершен': 'paid',
  'Завершён': 'paid',
  'Активен': 'active',
  'Оплачено': 'paid',
};

// Получить product_id по tariff_id
async function getProductIdByTariff(supabase: any, tariffId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tariffs')
    .select('product_id')
    .eq('id', tariffId)
    .single();
  
  return data?.product_id || null;
}

// Парсинг даты из разных форматов
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString();
  
  // Попробуем разные форматы
  // DD.MM.YYYY или DD.MM.YYYY HH:MM
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toISOString();
  }
  
  // YYYY-MM-DD
  const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmdd) {
    return new Date(dateStr).toISOString();
  }
  
  // Пробуем как есть
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  
  return new Date().toISOString();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { deals, instance_id } = await req.json();
    
    if (!Array.isArray(deals) || deals.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No deals provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Import File] Starting import of ${deals.length} deals`);

    // Инициализация Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Кэш для product_id
    const productCache: Record<string, string> = {};

    for (const deal of deals as DealFromFile[]) {
      try {
        // Пропускаем сделки без email или tariff
        if (!deal.email) {
          console.log(`[Import] Skipping deal ${deal.id}: no email`);
          result.orders_skipped++;
          continue;
        }

        if (!deal.tariffId) {
          console.log(`[Import] Skipping deal ${deal.id}: no tariff`);
          result.orders_skipped++;
          result.details.push(`Пропущен ${deal.email}: не определён тариф`);
          continue;
        }

        // Получаем product_id
        if (!productCache[deal.tariffId]) {
          const productId = await getProductIdByTariff(supabase, deal.tariffId);
          if (!productId) {
            console.log(`[Import] Skipping deal ${deal.id}: tariff ${deal.tariffId} not found`);
            result.orders_skipped++;
            result.details.push(`Пропущен ${deal.email}: тариф не найден`);
            continue;
          }
          productCache[deal.tariffId] = productId;
        }
        const productId = productCache[deal.tariffId];

        // 1. Найти или создать профиль
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, user_id')
          .eq('email', deal.email.toLowerCase().trim())
          .maybeSingle();

        let profileUserId: string;

        if (existingProfile) {
          profileUserId = existingProfile.user_id;
          result.profiles_updated++;
        } else {
          // Создаём ghost профиль
          const fullName = [deal.firstName, deal.lastName].filter(Boolean).join(' ') || null;
          const ghostUserId = crypto.randomUUID();

          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert({
              user_id: ghostUserId,
              email: deal.email.toLowerCase().trim(),
              full_name: fullName,
              phone: deal.phone,
              status: 'ghost',
            })
            .select('id, user_id')
            .single();

          if (profileError) {
            console.error(`[Import] Error creating profile for ${deal.email}:`, profileError);
            result.errors++;
            result.details.push(`Ошибка создания профиля: ${deal.email}`);
            continue;
          }

          profileUserId = newProfile.user_id;
          result.profiles_created++;
        }

        // 2. Проверяем дубликат заказа
        const gcOrderNumber = `GC-${deal.id}`;
        const { data: existingOrder } = await supabase
          .from('orders_v2')
          .select('id')
          .eq('order_number', gcOrderNumber)
          .maybeSingle();

        if (existingOrder) {
          console.log(`[Import] Order ${gcOrderNumber} already exists, skipping`);
          result.orders_skipped++;
          continue;
        }

        // 3. Создаём заказ
        const status = STATUS_MAP[deal.status] || 'pending';
        const createdAt = parseDate(deal.createdAt);
        const paidAt = parseDate(deal.paidAt);

        const { data: newOrder, error: orderError } = await supabase
          .from('orders_v2')
          .insert({
            order_number: gcOrderNumber,
            user_id: profileUserId,
            product_id: productId,
            tariff_id: deal.tariffId,
            base_price: deal.cost,
            final_price: deal.cost,
            paid_amount: status === 'paid' ? deal.cost : 0,
            currency: 'BYN',
            status,
            customer_email: deal.email.toLowerCase().trim(),
            customer_phone: deal.phone,
            is_trial: false,
            meta: {
              gc_deal_id: deal.id,
              gc_offer_name: deal.offerName,
              imported_at: new Date().toISOString(),
              import_source: 'file',
            },
            created_at: createdAt,
            updated_at: paidAt,
          })
          .select('id')
          .single();

        if (orderError) {
          console.error(`[Import] Error creating order for ${deal.email}:`, orderError);
          result.errors++;
          result.details.push(`Ошибка создания заказа: ${deal.email}`);
          continue;
        }

        result.orders_created++;

        // 4. Создаём подписку для оплаченных заказов
        if (status === 'paid') {
          const accessStartAt = paidAt;
          const startDate = new Date(accessStartAt);
          
          // Calendar month for club at 21:00 UTC (end of day Minsk)
          const CLUB_PRODUCT_ID = "11c9f1b8-0355-4753-bd74-40b42aa53616";
          let endDate: Date;
          if (productId === CLUB_PRODUCT_ID) {
            endDate = new Date(Date.UTC(
              startDate.getUTCFullYear(),
              startDate.getUTCMonth() + 1,
              startDate.getUTCDate(),
              21, 0, 0
            ));
            // Edge case: 31 Jan → 28/29 Feb
            if (endDate.getUTCDate() !== startDate.getUTCDate()) {
              endDate = new Date(Date.UTC(
                startDate.getUTCFullYear(),
                startDate.getUTCMonth() + 2,
                0, 21, 0, 0
              ));
            }
          } else {
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 30);
          }

          const now = new Date();
          const subStatus = endDate > now ? 'active' : 'expired';

          const { error: subError } = await supabase
            .from('subscriptions_v2')
            .insert({
              user_id: profileUserId,
              product_id: productId,
              tariff_id: deal.tariffId,
              order_id: newOrder.id,
              status: subStatus,
              access_start_at: accessStartAt,
              access_end_at: endDate.toISOString(),
              is_trial: false,
              meta: {
                gc_deal_id: deal.id,
                imported_at: new Date().toISOString(),
                import_source: 'file',
              },
            });

          if (subError) {
            console.error(`[Import] Error creating subscription for ${deal.email}:`, subError);
            result.details.push(`Ошибка создания подписки: ${deal.email}`);
          } else {
            result.subscriptions_created++;
          }
        }

        console.log(`[Import] Successfully imported deal ${deal.id} for ${deal.email}`);

      } catch (error) {
        console.error(`[Import] Error processing deal ${deal.id}:`, error);
        result.errors++;
        result.details.push(`Ошибка обработки: ${deal.email || deal.id}`);
      }
    }

    console.log(`[Import] Complete. Created: ${result.orders_created}, Skipped: ${result.orders_skipped}, Errors: ${result.errors}`);

    // Логируем в integration_logs если есть instance_id
    if (instance_id) {
      await supabase.from('integration_logs').insert({
        instance_id,
        event_type: 'file_import',
        result: result.errors === 0 ? 'success' : 'partial',
        payload_meta: {
          total: deals.length,
          orders_created: result.orders_created,
          orders_skipped: result.orders_skipped,
          errors: result.errors,
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Import File] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
