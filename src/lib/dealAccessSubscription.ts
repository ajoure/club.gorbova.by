import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export async function loadDealAccessSubscription(db: SupabaseClient<Database>, deal: {
  id: string;
  user_id: string | null;
  product_id: string;
  tariff_id: string | null;
}) {
  if (!deal.user_id) return null;
  const scoped = () => {
    let query = db.from('subscriptions_v2').select('*')
      .eq('user_id', deal.user_id).eq('product_id', deal.product_id);
    query = deal.tariff_id ? query.eq('tariff_id', deal.tariff_id) : query.is('tariff_id', null);
    return query;
  };
  const direct = await scoped().eq('order_id', deal.id).maybeSingle();
  if (direct.error) throw direct.error;
  const extended = await scoped().contains('meta', { extended_by_orders: [deal.id] }).maybeSingle();
  if (extended.error) throw extended.error;
  const linked = [...new Map([direct.data, extended.data].filter(Boolean).map(row => [row.id, row])).values()];
  const active = linked.filter(row => row.status === 'active');
  if (active.length === 1) return active[0];
  if (linked.length <= 1) return linked[0] || null;
  // Never select by newest expiry or reactivate an arbitrary historical row.
  throw new Error('Неоднозначная связь сделки с подписками. Требуется ручная проверка.');
}
