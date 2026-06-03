// Phase 2 — Stripe metadata contract
// Single point of metadata assembly for Stripe API calls.
// Required fields are validated before sending.

export interface StripeMetadataInput {
  order_id: string;
  product_id: string;
  tariff_id: string;
  business_stream?: string | null;
  account_code: string;          // e.g. 'stripe_poland'
  offer_id?: string | null;
  payment_link_id?: string | null;
  contact_id?: string | null;
  user_id?: string | null;
  profile_code?: string | null;
}

export interface ValidatedStripeMetadata {
  order_id: string;
  product_id: string;
  tariff_id: string;
  business_stream: string;
  account_code: string;
  provider: 'stripe';
  offer_id?: string;
  payment_link_id?: string;
  contact_id?: string;
  user_id?: string;
  profile_code?: string;
}

export function buildStripeMetadata(input: StripeMetadataInput): ValidatedStripeMetadata {
  const required: Array<[string, unknown]> = [
    ['order_id', input.order_id],
    ['product_id', input.product_id],
    ['tariff_id', input.tariff_id],
    ['account_code', input.account_code],
  ];
  for (const [name, value] of required) {
    if (!value || typeof value !== 'string') {
      throw new Error(`stripe_metadata_missing:${name}`);
    }
  }

  const meta: ValidatedStripeMetadata = {
    order_id: input.order_id,
    product_id: input.product_id,
    tariff_id: input.tariff_id,
    business_stream: input.business_stream ?? 'default',
    account_code: input.account_code,
    provider: 'stripe',
  };
  if (input.offer_id) meta.offer_id = input.offer_id;
  if (input.payment_link_id) meta.payment_link_id = input.payment_link_id;
  if (input.contact_id) meta.contact_id = input.contact_id;
  if (input.user_id) meta.user_id = input.user_id;
  if (input.profile_code) meta.profile_code = input.profile_code;
  return meta;
}

/**
 * Flatten metadata to Stripe's `metadata[key]=value` form-encoded shape.
 * Stripe accepts up to 50 metadata keys of <= 500 chars each.
 */
export function metadataToFormPairs(meta: Record<string, string>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    pairs.push([`metadata[${k}]`, String(v)]);
  }
  return pairs;
}
