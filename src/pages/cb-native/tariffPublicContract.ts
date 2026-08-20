import type { PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";

const ACTIONABLE_TYPES = new Set([
  "pay_now",
  "trial",
  "preregistration",
  "lead",
  "bank_installment",
  "invoice",
]);

// Public placement is configured by administrators in offer.meta.slot_role.
// The payment contract determines the canonical visual order; slot names are
// only a fallback because historical records use both button_3 and button_4
// for the same two-payment action.
const SLOT_CTA_ORDER: Record<string, number> = {
  button_1: 0, // 100% card payment
  button_5: 1, // Resource Development / bank installment application
  button_4: 2, // internal installment (two payments)
  button_2: 3, // legal-entity invoice
  button_3: 4, // ordinary manager application
};

const offerSemanticOrder = (offer: TariffOffer) => {
  if (offer.offer_type === "bank_installment") return 1;
  if (offer.payment_method === "internal_installment") return 2;
  if (offer.offer_type === "invoice") return 3;
  if (offer.offer_type === "lead" || offer.offer_type === "preregistration") return 4;
  if (offer.offer_type === "pay_now" || offer.offer_type === "trial") return 0;

  const slot = offer.meta?.slot_role?.trim();
  if (slot && slot in SLOT_CTA_ORDER) return SLOT_CTA_ORDER[slot];
  if (offer.payment_method === "bank_transfer") return 3;
  return 99;
};

export const normalizeCbTariffIdentity = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const resolveCbTariffCardIndex = (tariff: PublicTariff, fallbackIndex = 0) => {
  const configuredKey = normalizeCbTariffIdentity(tariff.meta?.site_slot_key);
  const name = normalizeCbTariffIdentity(tariff.name);
  const code = normalizeCbTariffIdentity(tariff.code);
  const identity = `${configuredKey}_${code}_${name}`;

  if (/(business_lady|biznes_ledi|бизнес_леди)/.test(identity)) return 2;
  if (/(gl_buh|chief_accountant|главн.*бухгалтер)/.test(identity)) return 1;
  if (/(^|_)(buh|accountant|бухгалтер)(_|$)/.test(identity)) return 0;
  return Math.min(Math.max(fallbackIndex, 0), 2);
};

export const sortCbTariffsForDisplay = (tariffs: PublicTariff[]) =>
  tariffs
    .map((tariff, originalIndex) => ({ tariff, originalIndex }))
    .sort((a, b) => {
      const semantic =
        resolveCbTariffCardIndex(a.tariff, a.originalIndex) -
        resolveCbTariffCardIndex(b.tariff, b.originalIndex);
      if (semantic !== 0) return semantic;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ tariff }) => tariff);

export const selectAndSortCbOffers = (allOffers: TariffOffer[]) => {
  const active = allOffers.filter(
    (offer) => offer.is_active !== false && ACTIONABLE_TYPES.has(offer.offer_type),
  );
  const hasConfiguredPublicSlots = active.some((offer) => Boolean(offer.meta?.slot_role?.trim()));
  const publicOffers = hasConfiguredPublicSlots
    ? active.filter((offer) => Boolean(offer.meta?.slot_role?.trim()))
    : active;

  return publicOffers.slice().sort((a, b) => {
    const semantic = offerSemanticOrder(a) - offerSemanticOrder(b);
    if (semantic !== 0) return semantic;
    const configured = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (configured !== 0) return configured;
    return a.id.localeCompare(b.id);
  });
};
