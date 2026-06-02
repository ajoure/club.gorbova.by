// Phase 1 Stripe Integration — business_stream resolver
//
// Priority (per discovery `business_stream_classification_v1.md`):
//   1) tariff_offers.meta.business_stream
//   2) products_v2.meta.business_stream
//   3) explicit override (link.business_stream)
//   4) null  (defer to Phase 2 backfill)

export type BusinessStream =
  | 'accounting_school'
  | 'consulting'
  | 'documents'
  | 'club'
  | 'marketplace'
  | string;

export interface ResolveStreamArgs {
  tariff_offer_meta?: Record<string, unknown> | null;
  product_meta?: Record<string, unknown> | null;
  link_business_stream?: string | null;
}

export function resolveBusinessStream(args: ResolveStreamArgs): BusinessStream | null {
  const fromOffer = args.tariff_offer_meta?.business_stream;
  if (typeof fromOffer === 'string' && fromOffer.length > 0) return fromOffer;
  const fromProduct = args.product_meta?.business_stream;
  if (typeof fromProduct === 'string' && fromProduct.length > 0) return fromProduct;
  if (args.link_business_stream && args.link_business_stream.length > 0) {
    return args.link_business_stream;
  }
  return null;
}
