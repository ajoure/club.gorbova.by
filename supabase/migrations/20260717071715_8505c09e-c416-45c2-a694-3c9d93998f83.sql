
ALTER TABLE public.tariff_offers
  DROP CONSTRAINT IF EXISTS tariff_offers_offer_type_check;

ALTER TABLE public.tariff_offers
  ADD CONSTRAINT tariff_offers_offer_type_check
  CHECK (offer_type = ANY (ARRAY[
    'pay_now'::text,
    'trial'::text,
    'preregistration'::text,
    'lead'::text,
    'bank_installment'::text,
    'invoice'::text
  ]));
