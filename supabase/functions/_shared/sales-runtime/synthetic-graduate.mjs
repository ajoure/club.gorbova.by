// Preview-only catalogue selection. The caller must never pass this synthetic
// eligibility into checkoutReply or any writer.
const visible = (row, now) => row.is_active === true &&
  (!row.visible_from || Date.parse(row.visible_from) <= now) &&
  (!row.visible_to || Date.parse(row.visible_to) > now);

export function syntheticGraduateCatalogue({tariffs, offers, rules, addons, facts, rootModuleId, currency, now = Date.now()}) {
  const eligibleOffers = offers.filter(o => visible(o, now) &&
    o.meta?.purchase_eligibility?.kind === 'prior_purchase' &&
    o.meta?.sales_legacy_only !== true);
  const tariffIds = [...new Set(eligibleOffers.map(o => o.tariff_id))];
  if (tariffIds.length !== 1) throw Error('graduate_preview_catalogue_ambiguous');
  const tariff = tariffs.find(t => t.id === tariffIds[0] && !t.is_public && visible(t, now));
  if (!tariff) throw Error('graduate_preview_tariff_unavailable');
  const fullPay = eligibleOffers.filter(o => o.tariff_id === tariff.id &&
    o.offer_type === 'pay_now' && o.payment_method === 'full_payment' &&
    Number.isFinite(o.amount) && o.amount > 0);
  if (fullPay.length !== 1) throw Error('graduate_preview_price_ambiguous');
  const fullRule = rules.filter(r => r.tariff_id === tariff.id && r.is_active === true &&
    r.grant_target_type === 'training_content' && r.target_ref === rootModuleId &&
    r.conditions?.access_mode === 'full');
  if (fullRule.length !== 1) throw Error('graduate_preview_access_unverified');
  const topics = facts.filter(f => f.kind === 'topic' && f.module_id);
  if (!topics.length) throw Error('graduate_preview_topics_unavailable');
  const offer = fullPay[0];
  const permittedIds = new Set(eligibleOffers.map(o => o.id));
  const eligibleAddons = addons.filter(a => a.is_active === true && permittedIds.has(a.parent_offer_id) &&
    (!a.visible_from || Date.parse(a.visible_from) <= now) &&
    (!a.visible_to || Date.parse(a.visible_to) > now) &&
    a.addon_offer?.is_active === true && a.addon_product?.is_active === true);
  const sampleAddon = eligibleAddons.filter(a => a.parent_offer_id === offer.id &&
    a.pricing_mode === 'percent_discount' && Number(a.discount_percent) === 50 &&
    typeof a.addon_product?.name === 'string' && a.addon_product.name.trim() &&
    typeof a.addon_offer_id === 'string').sort((a,b)=>a.addon_product.name.localeCompare(b.addon_product.name,'ru'))[0];
  if (!sampleAddon) throw Error('graduate_preview_discounted_addon_unavailable');
  return {
    fact: {
      id: `synthetic_graduate_offer_${offer.id}`,
      text: `Тариф «${tariff.name}». Полная стоимость при оплате одним платежом — ${offer.amount} ${currency}.`,
      source: `access_rules:${fullRule[0].id};tariff_offers:${offer.id}`,
      classification: 'sales_safe', kind: 'offer', price: offer.amount,
      offer_id: offer.id, tariff_id: tariff.id,
      included_module_ids: [...new Set(topics.map(t => t.module_id))],
    },
    options: eligibleOffers.filter(o => o.tariff_id === tariff.id).map(o => ({
      id: o.id, tariff_id: tariff.id, tariff_name: tariff.name, amount: o.amount,
      offer_type: o.offer_type, payment_method: o.payment_method,
      installment_count: o.installment_count,
    })),
    addons: eligibleAddons,
    sampleAddon,
  };
}
