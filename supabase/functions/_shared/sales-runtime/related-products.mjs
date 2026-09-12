const plain=value=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/https?:\/\/\S+/g,'[ссылка в карточке продукта]').trim():'';
export function relatedProductIds(knowledge,currentProductId) {
 const ids=knowledge?.consultation_product_ids??[];
 if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))||new Set(ids).size!==ids.length) throw Error('invalid_consultation_products');
 return ids.filter(id=>id!==currentProductId);
}
/** Sales projection of the SAME public-product response used by the storefront.
 * No lesson text, private FAQ, contacts or checkout URLs enter this projection. */
export function compileRelatedProduct(snapshot,expectedId) {
 const p=snapshot?.product;
 if(!p||p.id!==expectedId||!p.name||!p.currency||!Array.isArray(snapshot.tariffs)) throw Error('related_catalog_unavailable');
 const facts=[];
 for(const t of snapshot.tariffs) {
  if(t.is_public!==true) continue;
  const features=(t.features??[]).map(f=>plain(f.text||f.label)).filter(Boolean);
  const benefits=(t.access_summary?.benefits??[]).map(b=>plain(b.title)+(b.days?` — ${b.days} дней`:'')+(b.conditional?' (по условиям тарифа)':''));
  const parts=[`Продукт «${plain(p.public_title||p.name)}», тариф «${plain(t.name)}».`,plain(t.description),...features,...benefits];
  // Conditional course-relative dates are never flattened to a generic duration.
  if(!t.meta?.course_access&&Number.isInteger(t.access_days)&&t.access_days>0) parts.push(`Срок доступа — ${t.access_days} дней.`);
  const text=parts.filter(Boolean).join('\n');
  if(text.length>2600) throw Error('related_catalog_fact_too_large');
  const source=`public-product:${p.id};tariff:${t.id}`;
  facts.push({id:`related_${t.id}`,product_id:p.id,text,source,classification:'sales_safe',kind:'related_product'});
  const offers=(t.offers??[]).filter(o=>o.offer_type==='pay_now'&&o.payment_method==='full_payment'&&!o.meta?.purchase_eligibility&&!o.meta?.sales_legacy_only&&Number.isFinite(o.amount)&&o.amount>0);
  const amounts=new Set(offers.map(o=>o.amount));
  // A mismatched storefront price is not silently chosen over the payment button.
  if(amounts.size===1&&offers[0].amount===t.current_price) facts.push({id:`related_price_${t.id}`,product_id:p.id,
   text:`«${plain(p.public_title||p.name)}», тариф «${plain(t.name)}»: ${offers[0].amount} ${p.currency}${t.period_label?` ${plain(t.period_label)}`:''}.`,
   source:source+`;offer:${offers[0].id}`,classification:'sales_safe',kind:'related_product'});
 }
 return facts;
}
