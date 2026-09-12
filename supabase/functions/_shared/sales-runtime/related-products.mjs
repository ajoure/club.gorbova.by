const plain=value=>typeof value==='string'?value.replace(/<[^>]*>/g,'').replace(/https?:\/\/\S+/g,'[ссылка в карточке продукта]').trim():'';
export function relatedProductIds(knowledge,currentProductId) {
 const ids=knowledge?.consultation_product_ids??[];
 if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))||new Set(ids).size!==ids.length) throw Error('invalid_consultation_products');
 return ids.filter(id=>id!==currentProductId);
}
/** Sales projection of the SAME public-product response used by the storefront.
 * No lesson text, private FAQ, contacts or checkout URLs enter this projection. */
export function compileRelatedProduct(snapshot,expectedId,now=Date.now()) {
 const p=snapshot?.product;
 if(!p||p.id!==expectedId||!p.name||!p.currency||!Array.isArray(snapshot.tariffs)) throw Error('related_catalog_unavailable');
 const facts=[];
 for(const t of snapshot.tariffs) {
  if(t.is_public!==true) continue;
  const features=(t.features??[]).filter(f=>{
   if(!f.visibility_mode||f.visibility_mode==='always') return true;
   if(!['until_date','date_range'].includes(f.visibility_mode)) return false;
   const from=f.active_from?Date.parse(f.active_from):null;
   const to=f.active_to?Date.parse(f.active_to):null;
   if((from!==null&&!Number.isFinite(from))||(to!==null&&!Number.isFinite(to))) return false;
   if(f.visibility_mode==='until_date') return to!==null&&now<=to;
   return (from===null||now>=from)&&(to===null||now<=to);
  }).map(f=>plain(f.text||f.label)).filter(Boolean);
  const benefits=(t.access_summary?.benefits??[]).map(b=>plain(b.title)+(b.days?` — ${b.days} дней`:'')+(b.conditional?' (по условиям тарифа)':''));
  const parts=[`Продукт «${plain(p.public_title||p.name)}», тариф «${plain(t.name)}».`,plain(t.description),...features,...benefits];
  // Conditional course-relative dates are never flattened to a generic duration.
  if(!t.meta?.course_access&&Number.isInteger(t.access_days)&&t.access_days>0) parts.push(`Срок доступа — ${t.access_days} дней.`);
  const text=parts.filter(Boolean).join('\n');
  if(text.length>2600) throw Error('related_catalog_fact_too_large');
  const source=`public-product:${p.id};tariff:${t.id}`;
  facts.push({id:`related_${t.id}`,product_id:p.id,text,source,classification:'sales_safe',kind:'related_product'});
  const payNow=(t.offers??[]).filter(o=>o.offer_type==='pay_now'&&o.is_active!==false);
  const primary=payNow.find(o=>o.is_primary)||payNow[0];
  const offers=payNow.filter(o=>o.payment_method==='full_payment'&&!o.meta?.purchase_eligibility&&!o.meta?.sales_legacy_only&&Number.isFinite(o.amount)&&o.amount>0);
  const amounts=new Set(offers.map(o=>o.amount));
  // TariffCard displays primary pay_now.amount before current_price/card_config.
  // Quote only an unrestricted full payment that matches that actual display.
  const cc=t.card_config||t.meta?.card_config;
  const suffix=plain(cc?.price_suffix||t.period_label||p.landing_config?.price_suffix||p.currency);
  const units=suffix.includes(p.currency)?suffix:`${p.currency} ${suffix}`;
  if(amounts.size===1&&offers.includes(primary)&&offers[0].amount===primary.amount) facts.push({id:`related_price_${t.id}`,product_id:p.id,
   text:`«${plain(p.public_title||p.name)}», тариф «${plain(t.name)}»: ${offers[0].amount} ${units}.`,
   source:source+`;offer:${offers[0].id}`,classification:'sales_safe',kind:'related_product'});
 }
 return facts;
}
