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
// The slot name is intentionally decoupled from the visual order: changing a
// database sort_order must not turn an invoice into the first card-payment CTA.
const SLOT_CTA_ORDER: Record<string, number> = {
  button_1: 0, // 100% card payment
  button_4: 1, // internal installment
  button_5: 2, // Resource Development / bank installment application
  button_3: 3, // ordinary manager application
  button_2: 4, // legal-entity invoice
};

const offerSemanticOrder = (offer: TariffOffer) => {
  const slot = offer.meta?.slot_role?.trim();
  if (slot && slot in SLOT_CTA_ORDER) return SLOT_CTA_ORDER[slot];
  if (offer.offer_type === "invoice" || offer.payment_method === "bank_transfer") return 4;
  if (offer.offer_type === "bank_installment") return 2;
  if (offer.offer_type === "lead") return 3;
  if (offer.payment_method === "internal_installment") return 1;
  if (offer.offer_type === "preregistration") return 1;
  if (offer.offer_type === "pay_now" || offer.offer_type === "trial") return 0;
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
