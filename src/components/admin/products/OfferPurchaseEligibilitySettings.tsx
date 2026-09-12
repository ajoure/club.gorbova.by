import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OfferMetaConfig, PurchaseEligibility } from "@/hooks/useTariffOffers";

export function validatePurchaseEligibility(rule?: PurchaseEligibility): string | null {
  if (!rule) return null;
  if (rule.kind !== "prior_purchase" || !rule.sources?.length) return "Выберите хотя бы один ранее оплаченный продукт.";
  if (rule.sources.some(s=>!s.product_id || (s.purchased_from && !Number.isFinite(Date.parse(s.purchased_from))))) return "Проверьте продукты и даты в условиях покупки.";
  return null;
}

/** Part of the existing offer form: its Save action persists the same meta. */
export function OfferPurchaseEligibilitySettings({value,onChange}:{value:OfferMetaConfig;onChange:(next:OfferMetaConfig)=>void}) {
  const {data} = useQuery({queryKey:["offer-eligibility-catalog"],queryFn:async()=>{
    const [products,tariffs]=await Promise.all([
      supabase.from("products_v2").select("id,name").order("name"),
      supabase.from("tariffs").select("id,code,product_id,name").order("name"),
    ]);
    if(products.error||tariffs.error) throw products.error||tariffs.error;
    return {products:products.data,tariffs:tariffs.data};
  }});
  const rule=value.purchase_eligibility;
  const update=(index:number,patch:Partial<PurchaseEligibility["sources"][number]>)=>onChange({...value,purchase_eligibility:{...rule!,sources:rule!.sources.map((s,i)=>i===index?{...s,...patch}:s)}});
  return <Card><CardHeader><CardTitle className="text-sm">Кому доступна эта кнопка оплаты</CardTitle></CardHeader><CardContent className="space-y-4">
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!value.sales_legacy_only} onChange={e=>onChange({...value,sales_legacy_only:e.target.checked})}/>Только ранее созданные ссылки. Не использовать для новых продаж.</label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={!!rule} onChange={e=>onChange({...value,purchase_eligibility:e.target.checked?{kind:"prior_purchase",sources:[]}:undefined})}/>Требуется предыдущая оплаченная покупка</label>
    {rule && <><p className="text-xs text-muted-foreground">Достаточно одного из продуктов ниже. Бесплатные доступы, пробные покупки и возвраты не подходят. Проверяется получатель ссылки, в том числе при продаже помощником.</p>
      {rule.sources.map((source,index)=><div key={index} className="space-y-3 rounded border p-3">
        <label className="block text-sm">Продукт<select className="mt-1 w-full rounded border bg-background p-2" aria-label={`Предыдущий продукт ${index+1}`} value={source.product_id} onChange={e=>update(index,{product_id:e.target.value,excluded_tariff_ids:[]})}><option value="">Выберите продукт</option>{data?.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block text-sm">Покупки начиная с даты (по Минску)<Input type="date" value={source.purchased_from?.slice(0,10)||""} onChange={e=>update(index,{purchased_from:e.target.value?`${e.target.value}T00:00:00+03:00`:undefined})}/></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={!!source.allow_paid_import} onChange={e=>update(index,{allow_paid_import:e.target.checked})}/>Учитывать подтверждённые оплаченные заказы, импортированные из GetCourse</label>
        <fieldset className="space-y-2 text-sm"><legend>Исключить тарифы</legend>{data?.tariffs.filter(t=>t.product_id===source.product_id).map(t=><label key={t.id} className="flex gap-2"><input type="checkbox" checked={source.excluded_tariff_ids?.includes(t.id)||source.excluded_tariff_ids?.includes(t.code)||false} onChange={e=>update(index,{excluded_tariff_ids:e.target.checked?[...(source.excluded_tariff_ids||[]),t.id,t.code].filter(Boolean):source.excluded_tariff_ids?.filter(id=>id!==t.id&&id!==t.code)})}/>{t.name}</label>)}</fieldset>
        <Button variant="outline" size="sm" onClick={()=>onChange({...value,purchase_eligibility:{...rule,sources:rule.sources.filter((_,i)=>i!==index)}})}>Удалить условие</Button>
      </div>)}
      <Button variant="outline" size="sm" onClick={()=>onChange({...value,purchase_eligibility:{...rule,sources:[...rule.sources,{product_id:"",excluded_tariff_ids:[]}]}})}>Добавить продукт</Button>
    </>}
  </CardContent></Card>;
}
