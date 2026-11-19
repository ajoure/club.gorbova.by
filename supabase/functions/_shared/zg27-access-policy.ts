import { ZG27_PRODUCT_ID, ZG27_TIERS, ZG27_ACCESS_END_EXCLUSIVE } from './zg27-policy.ts';
import { courseAccessEndForPurchase } from './course-access-window.ts';
/** Scoped commercial cap. Other products keep their historical merge and replay semantics. */
export function zg27FixedEnd(order: any, tariffMeta: unknown): Date | null {
  if (order.product_id !== ZG27_PRODUCT_ID) return null;
  if (![ZG27_TIERS.first.tariffId, ZG27_TIERS.repeat.tariffId].includes(order.tariff_id)) throw Error('zg27_access_tariff_invalid');
  const end = courseAccessEndForPurchase(tariffMeta, order.purchase_snapshot);
  if (!end || end.toISOString() !== ZG27_ACCESS_END_EXCLUSIVE) throw Error('zg27_access_policy_invalid');
  return end;
}
export function cappedZg27Merge(existing: string | null | undefined, proposed: Date, fixed: Date | null): string {
  if (fixed) return fixed.toISOString();
  return existing && Date.parse(existing) > proposed.getTime() ? existing : proposed.toISOString();
}
export function zg27SubscriptionProvenance(sub: any, order: any): boolean {
  return !!sub && sub.user_id === order.user_id && sub.product_id === order.product_id && sub.tariff_id === order.tariff_id
    && (sub.order_id === order.id || (Array.isArray(sub.meta?.extended_by_orders) && sub.meta.extended_by_orders.includes(order.id)));
}
